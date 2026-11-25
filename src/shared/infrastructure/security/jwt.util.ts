// === RF-AUTH-02: Login, Gestión de Sesión Segura y Recuperación de Contraseña ===
//
// Generación y verificación de JWT RS256 propios.
//
// Por qué RS256 (asimétrico) en lugar de HS256 (simétrico):
//   - Microservicios o BFFs pueden verificar tokens con la clave pública
//     sin necesidad de tener la clave privada.
//   - Separación de responsabilidades: solo este servidor emite tokens.
//
// Carga de claves (lazy):
//   Las claves se leen de process.env vía config al primer uso (lazy getters),
//   para compatibilidad con tests (los mocks se registran antes de que se
//   carguen las claves).
//
// Formato de claves esperado en .env:
//   JWT_PRIVATE_KEY = PEM PKCS#8  (-----BEGIN PRIVATE KEY-----)
//   JWT_PUBLIC_KEY  = PEM SPKI    (-----BEGIN PUBLIC KEY-----)
//
//   Los saltos de línea se escriben como \n literal y se reemplazan en config.js.
//   Generación:
//     openssl genpkey -algorithm RSA -out private.pem -pkeyopt rsa_keygen_bits:2048
//     openssl rsa -pubout -in private.pem -out public.pem

import { SignJWT, jwtVerify, decodeJwt } from 'jose';
import cryptoModule from 'node:crypto';
const { createPrivateKey, createPublicKey } = cryptoModule;
import type { KeyObject } from 'node:crypto';
import type { JWTPayload } from 'jose';
import { UnauthorizedError } from '../../domain/errors/domain-error';
import loggerUtilModule from '../observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../config';
const { jwt: jwtConfig, AUTH_ERROR_CODES } = constantsModule;
import errorMessageModule from '../../kernel/error-message.util';

const { errorMessage } = errorMessageModule;


const ALGORITHM = 'RS256';

// Reto MFA entre /auth/login y /auth/verify-mfa. Prueba que la CONTRASEÑA ya se
// validó, para que verify-mfa no acepte solo (nationalId + código) — antes esa
// garantía la daba el `session` opaco de Cognito. Vida corta: el usuario tiene
// que ingresar su segundo factor en esta ventana.
const MFA_CHALLENGE_EXPIRY_SECONDS = 300; // 5 min
const MFA_CHALLENGE_TYPE = 'mfa_challenge';

/** Lo que necesita el access token del usuario (fila de User con rol y persona cargados). */
interface TokenUser {
  userId: string;
  personId?: string | null;
  roleId?: string | null;
  /** User no tiene esta columna: el claim sale null salvo que el llamador lo pase (el documento va en person). */
  nationalId?: string | null;
  authUsername?: string | null;
  role?: { name?: string | null } | null;
  person?: { firstName?: string | null; lastName?: string | null; contact?: { email?: string | null } | null } | null;
}

/** Claims que emite generateAccessToken (+ las estándar de JWT: iat, exp, sub…). */
interface AccessTokenClaims extends JWTPayload {
  sessionId?: string | null;
  userId?: string;
  personId?: string | null;
  roleId?: string | null;
  roleName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  nationalId?: string | null;
  authUsername?: string | null;
  email?: string | null;
}

/** Claims del refresh token ya validados (generateRefreshToken los emite siempre). */
interface RefreshTokenClaims extends JWTPayload {
  userId: string;
  jti: string;
  sessionId: string | null;
  type: 'refresh';
}

/** ¿jose rechazó el token por vencido? (el resto de los rechazos son firma, formato o algoritmo inválidos) */
const isExpired = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'ERR_JWT_EXPIRED');

const unauthorized = (message: string, code?: string) => new UnauthorizedError(message, 'UNAUTHORIZED', code ? { code } : null);

class JwtUtil {
  private static __privateKey: KeyObject | undefined;
  private static __publicKey: KeyObject | undefined;

  // ── Lazy getters ───────────────────────────────────────────────────────────

  static get _privateKey(): KeyObject {
    if (!this.__privateKey) {
      if (!jwtConfig.privateKey) {
        throw new Error('JWT_PRIVATE_KEY no configurada');
      }
      this.__privateKey = createPrivateKey(jwtConfig.privateKey);
    }
    return this.__privateKey;
  }

  static get _publicKey(): KeyObject {
    if (!this.__publicKey) {
      if (!jwtConfig.publicKey) {
        throw new Error('JWT_PUBLIC_KEY no configurada');
      }
      this.__publicKey = createPublicKey(jwtConfig.publicKey);
    }
    return this.__publicKey;
  }

  // ============================================================
  // EMISIÓN
  // ============================================================

  /**
   * Genera un access token RS256 con todos los claims del usuario.
   * Expira en `jwtConfig.accessTokenExpiry` segundos (default 900 = 15 min).
   *
   * @param {Object} user       - Instancia del modelo User con asociaciones cargadas
   * @param {string} sessionId  - UUID de la sesión activa (generado en login, estable hasta logout)
   * @returns {Promise<string>} JWT firmado
   */
  // [RF-AUTH-02] | CA-01 | Genera access token RS256 con claims de sesión
  static generateAccessToken(user: TokenUser, sessionId: string | null): Promise<string> {
    const nowSecs = Math.floor(Date.now() / 1000);

    const payload = {
      sessionId: sessionId || null,
      userId: user.userId,
      personId: user.personId || null,
      roleId: user.roleId || null,
      roleName: user.role?.name || null,
      firstName: user.person?.firstName || null,
      lastName: user.person?.lastName || null,
      nationalId: user.nationalId || null,
      authUsername: user.authUsername || null,
      email: user.person?.contact?.email || null
    };

    return new SignJWT(payload)
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(user.userId)
      .setIssuedAt(nowSecs)
      .setExpirationTime(nowSecs + jwtConfig.accessTokenExpiry)
      .sign(JwtUtil._privateKey);
  }

  /**
   * Genera un refresh token RS256. El JTI se almacena en Redis por el caller.
   *
   * Tope absoluto: 24h (`exp`). Antes de eso la sesión muere por inactividad
   * (worker + middleware), logout, o rotación (al usarse, el JTI anterior se
   * revoca; un JTI ausente en Redis se trata como reuse attack). El `exp` de
   * 24h es solo el techo máximo de vida del refresh token.
   *
   * @param {string} userId
   * @param {string} jti        - UUID único del token (generado por el caller)
   * @param {string} sessionId  - UUID de la sesión activa
   * @returns {Promise<string>} JWT firmado
   */
  // [RF-AUTH-02] | CA-01 | Genera refresh token RS256 con jti para rotación (tope absoluto 24h)
  static generateRefreshToken(userId: string, jti: string, sessionId: string | null): Promise<string> {
    const nowSecs = Math.floor(Date.now() / 1000);

    return new SignJWT({ userId, sessionId: sessionId || null, type: 'refresh' })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(userId)
      .setJti(jti)
      .setIssuedAt(nowSecs)
      .setExpirationTime('24h')
      .sign(JwtUtil._privateKey);
  }

  // ============================================================
  // VERIFICACIÓN
  // ============================================================

  /**
   * Verifica la firma RS256 propia y la expiración. Si jose lo rechaza, lo loguea y lanza `rejection(expired)`.
   */
  private static async _verifySignature(token: string, logMessage: string, rejection: (expired: boolean) => Error): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, JwtUtil._publicKey, { algorithms: [ALGORITHM] });
      return payload;
    } catch (error) {
      logger.warn(logMessage, { error: errorMessage(error) });
      throw rejection(isExpired(error));
    }
  }

  /**
   * Verifica un access token RS256 y retorna el payload decodificado.
   * Lanza UnauthorizedError (401) si la firma es inválida o el token expiró.
   */
  // [RF-AUTH-02] | CA-01, CA-02 | Verifica firma RS256; usado en middleware para validar blacklist
  static async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const payload = await JwtUtil._verifySignature(token, 'JWT access token inválido', expired =>
      // TOKEN_EXPIRED es el único 401 recuperable: el front debe renovar con /auth/refresh y reintentar, no
      // desloguear. Ver shared/domain/constants/auth-error-codes.
      expired ? unauthorized('Token expirado', AUTH_ERROR_CODES.TOKEN_EXPIRED) : unauthorized('Token inválido', AUTH_ERROR_CODES.TOKEN_INVALID)
    );
    // La firma RS256 propia ya se verificó: las claims son las que emitió generateAccessToken.
    return payload as AccessTokenClaims;
  }

  /**
   * Decodifica un JWT SIN verificar la firma. Solo para derivar una clave de agrupación
   * (rate limit / lock por sesión) antes de que el token sea validado río abajo.
   *
   * ⚠️ Nunca usar el resultado para autorizar: el payload no está verificado. Si el token es
   * inválido, el flujo lo rechaza igual más adelante — acá solo interesa no meter a todas las
   * sesiones que salen por una misma IP en el mismo cubo de rate limit.
   *
   * @param {string} token
   * @returns {Object|null} payload sin verificar, o null si no es un JWT decodificable
   */
  static decodeUnverified(token: unknown): JWTPayload | null {
    if (!token || typeof token !== 'string') {
      return null;
    }
    try {
      return decodeJwt(token);
    } catch {
      return null;
    }
  }

  /**
   * Verifica un refresh token RS256 y retorna el payload decodificado.
   * Lanza UnauthorizedError (401, REFRESH_TOKEN_INVALID) si la firma es inválida, expiró o no es un refresh.
   */
  // [RF-AUTH-02] | CA-01 | Verifica tipo 'refresh' y firma RS256
  static async verifyRefreshToken(token: string): Promise<RefreshTokenClaims> {
    const invalid = () => unauthorized('Refresh token inválido', AUTH_ERROR_CODES.REFRESH_TOKEN_INVALID);
    const payload = await JwtUtil._verifySignature(token, 'JWT refresh token inválido', expired =>
      expired ? unauthorized('Refresh token expirado. Por favor inicia sesión nuevamente.', AUTH_ERROR_CODES.REFRESH_TOKEN_INVALID) : invalid()
    );

    // Firma válida pero no es un refresh, o le faltan los claims que usa la rotación → inválido (no seguir con undefined)
    if (payload.type !== 'refresh' || typeof payload.userId !== 'string' || typeof payload.jti !== 'string') {
      logger.warn('JWT refresh token inválido', { error: 'tipo o claims incorrectos' });
      throw invalid();
    }

    return {
      ...payload,
      userId: payload.userId,
      jti: payload.jti,
      sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : null,
      type: 'refresh'
    };
  }

  // ============================================================
  // RETO MFA (login en dos pasos)
  // ============================================================

  /**
   * Emite el token de reto MFA que /auth/login devuelve cuando el usuario tiene
   * MFA activo. Se entrega en el campo `session` de la respuesta y el frontend lo
   * reenvía a /auth/verify-mfa junto con el código TOTP/SMS.
   *
   * Sustituye al `session` opaco que antes emitía Cognito: garantiza que la
   * contraseña ya se validó en el paso 1 antes de aceptar el segundo factor.
   *
   * @param {string} userId
   * @returns {Promise<string>} JWT firmado (vida 5 min)
   */
  static generateMfaChallengeToken(userId: string): Promise<string> {
    const nowSecs = Math.floor(Date.now() / 1000);
    return new SignJWT({ userId, type: MFA_CHALLENGE_TYPE })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(userId)
      .setIssuedAt(nowSecs)
      .setExpirationTime(nowSecs + MFA_CHALLENGE_EXPIRY_SECONDS)
      .sign(JwtUtil._privateKey);
  }

  /**
   * Verifica el token de reto MFA. Lanza UnauthorizedError (401) si la firma es inválida, expiró o el tipo no
   * corresponde. Retorna el payload con `userId`.
   */
  static async verifyMfaChallengeToken(token: string): Promise<JWTPayload> {
    const invalid = () => unauthorized('Token de reto MFA inválido');
    const payload = await JwtUtil._verifySignature(token, 'JWT reto MFA inválido', expired =>
      expired ? unauthorized('El reto MFA expiró. Vuelve a iniciar sesión.') : invalid()
    );
    if (payload.type !== MFA_CHALLENGE_TYPE) {
      logger.warn('JWT reto MFA inválido', { error: 'tipo incorrecto' });
      throw invalid();
    }
    return payload;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace JwtUtil {
  export type RefreshClaims = RefreshTokenClaims;
  export type AccessClaims = AccessTokenClaims;
}

export default JwtUtil;
