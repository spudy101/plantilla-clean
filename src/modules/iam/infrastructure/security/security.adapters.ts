// Adaptadores de los puertos de seguridad de iam con las utilidades de shared/infrastructure y los paquetes npm:
// tokens RS256 (JwtUtil), contraseñas (bcrypt), TOTP, cifrado, aleatoriedad (node:crypto), firmas ES256 y HMAC,
// API keys, la descripción de un dispositivo, la disponibilidad de Redis, la caché de overrides del RBAC y el
// contexto de la operación.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import redisClient from '../../../../shared/infrastructure/cache/redis.util';
import constantsModule from '../../../../shared/infrastructure/config';
import requestContext from '../../../../shared/infrastructure/observability/request-context.util';
import DeviceFingerprintUtil from '../../../../shared/infrastructure/security/device-fingerprint.util';
import EncryptionUtil from '../../../../shared/infrastructure/security/encryption.util';
import es256SignatureUtilModule from '../../../../shared/infrastructure/security/es256-signature.util';
import JwtUtil from '../../../../shared/infrastructure/security/jwt.util';
import TotpUtil from '../../../../shared/infrastructure/security/totp.util';
import type { CacheAvailability, TokenService } from '../../application/ports/auth-tokens.port';
import type { PermissionOverrideCache } from '../../application/ports/role-repository.port';
import type {
  ApiKeyVerifier,
  DeviceDescriber,
  OperationSession,
  PasswordHasher,
  RandomSource,
  RequestSigner,
  SecretCipher,
  SignatureVerifier,
  TotpService
} from '../../application/ports/security.port';
import type { PermissionOverride } from '../../domain/rbac';

const { jwt: jwtConfig, encryption } = constantsModule;
const { verifyEs256Signature } = es256SignatureUtilModule;

// [RF-AUTH-01] | CA-05 | bcrypt con rounds=10 y salt único (bcrypt.compare es timing-safe)
const BCRYPT_ROUNDS = 10;

export const jwtTokenService: TokenService = {
  accessTokenExpiry: jwtConfig.accessTokenExpiry,
  generateAccessToken: (user, sessionId) => JwtUtil.generateAccessToken(user, sessionId),
  generateRefreshToken: (userId, jti, sessionId) => JwtUtil.generateRefreshToken(userId, jti, sessionId),
  verifyAccessToken: token => JwtUtil.verifyAccessToken(token),
  verifyRefreshToken: token => JwtUtil.verifyRefreshToken(token),
  generateMfaChallengeToken: userId => JwtUtil.generateMfaChallengeToken(userId),
  verifyMfaChallengeToken: async token => ({ userId: (await JwtUtil.verifyMfaChallengeToken(token)).userId })
};

export const bcryptPasswordHasher: PasswordHasher = {
  hash: plainPassword => bcrypt.hash(plainPassword, BCRYPT_ROUNDS),
  matches: (plainPassword, passwordHash) => (passwordHash ? bcrypt.compare(plainPassword, passwordHash) : Promise.resolve(false))
};

export const totpService: TotpService = {
  generateSecret: () => TotpUtil.generateSecret(),
  keyuri: (accountName, secret) => TotpUtil.keyuri(accountName, secret),
  verify: (code, secret) => TotpUtil.verify(code, secret)
};

export const secretCipher: SecretCipher = {
  encrypt: plain => EncryptionUtil.encrypt(plain),
  decrypt: encrypted => EncryptionUtil.decrypt(encrypted)
};

export const cryptoRandomSource: RandomSource = {
  uuid: () => crypto.randomUUID(),
  hex: bytes => crypto.randomBytes(bytes).toString('hex'),
  base64url: bytes => crypto.randomBytes(bytes).toString('base64url'),
  int: (min, max) => crypto.randomInt(min, max)
};

export const es256SignatureVerifier: SignatureVerifier = {
  verify: input => verifyEs256Signature(input)
};

export const userAgentDeviceDescriber: DeviceDescriber = {
  describe: (userAgent, ip) => DeviceFingerprintUtil.enrichDevice(userAgent, ip)
};

export const hmacRequestSigner: RequestSigner = {
  sign: (timestamp, method, path, secret) => EncryptionUtil.generateRequestHmac(timestamp, method, path, secret),
  matches: (received, expected) => EncryptionUtil.verifyRequestHmac(received, expected)
};

/**
 * Comparación en tiempo constante: se hashea cada lado a longitud fija (sha256) y se recorren TODAS las claves sin
 * early-return, de modo que el tiempo no depende de cuántas coinciden.
 */
export const envApiKeyVerifier: ApiKeyVerifier = {
  isValid(apiKey: string | undefined): apiKey is string {
    if (!apiKey) {
      return false;
    }
    const validApiKeys = encryption.externalApiKeys ? encryption.externalApiKeys.split(',').map(k => k.trim()) : [];
    const received = crypto.createHash('sha256').update(apiKey).digest();
    let matched = false;
    for (const validKey of validApiKeys) {
      const expected = crypto.createHash('sha256').update(validKey).digest();
      if (crypto.timingSafeEqual(received, expected)) {
        matched = true;
      }
    }
    return matched;
  }
};

export const redisAvailability: CacheAvailability = {
  isAvailable: () => redisClient.isAvailable()
};

// v2: los overrides pasaron a camelCase (moduleName) con Prisma; la clave nueva evita leer entradas viejas.
const OVERRIDES_CACHE_PREFIX = 'rbac:overrides:v2:';
const OVERRIDES_CACHE_TTL_SECONDS = 60;

/** Fail-open: sin Redis, cada resolución consulta la base. */
export const redisPermissionOverrideCache: PermissionOverrideCache = {
  get: roleName => redisClient.get<PermissionOverride[]>(`${OVERRIDES_CACHE_PREFIX}${roleName}`),
  async set(roleName, overrides) {
    await redisClient.set(`${OVERRIDES_CACHE_PREFIX}${roleName}`, overrides, OVERRIDES_CACHE_TTL_SECONDS);
  },
  async invalidate(roleName) {
    await redisClient.del(`${OVERRIDES_CACHE_PREFIX}${roleName}`);
  }
};

/**
 * La sesión del request, en el contexto de la operación (AsyncLocalStorage): la auditoría la persiste sin tocar los
 * call sites. El middleware de auditoría corrió antes (sin usuario) pero dentro del mismo contexto: la referencia
 * del store es viva y la mutación llega al resto de la cadena.
 */
export const requestOperationSession: OperationSession = {
  bind(sessionId, userId) {
    const auditCtx = requestContext.get();
    if (auditCtx) {
      auditCtx.sessionId = sessionId ?? null;
      auditCtx.userId = userId ?? null;
    }
  }
};

