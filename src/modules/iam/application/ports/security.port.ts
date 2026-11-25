// Puertos: las primitivas de seguridad que usan los casos de uso (contraseñas, TOTP, cifrado, aleatoriedad, firmas,
// API keys) y cómo se clasifica un error inesperado.
import type { DeviceDescription } from '../../domain/trusted-device';

export interface PasswordHasher {
  hash(plainPassword: string): Promise<string>;
  /** Sin hash (cuenta sin contraseña local) nunca coincide. */
  matches(plainPassword: string, passwordHash: string | null): Promise<boolean>;
}

/** TOTP (RFC 6238). */
export interface TotpService {
  generateSecret(): string;
  /** La URL otpauth:// que lee la app autenticadora. */
  keyuri(accountName: string, secret: string): string;
  verify(code: string | null | undefined, secret: string | null | undefined): boolean;
}

/** Cifrado de secretos en reposo (el TOTP de cada usuario). */
export interface SecretCipher {
  encrypt(plain: string): string;
  decrypt(encrypted: string): string;
}

export interface RandomSource {
  /** Un UUID v4. */
  uuid(): string;
  /** `bytes` bytes aleatorios en hexadecimal. */
  hex(bytes: number): string;
  /** `bytes` bytes aleatorios en base64url. */
  base64url(bytes: number): string;
  /** Un entero en [min, max). */
  int(min: number, max: number): number;
}

/** La firma ES256 de un challenge con la llave pública del autenticador. */
export interface SignatureVerifier {
  verify(input: { publicKey: string; challenge: string; signature: string }): boolean;
}

/** Qué se sabe de un dispositivo por su user-agent y su IP (navegador, SO, tipo, ciudad, país). */
export interface DeviceDescriber {
  describe(userAgent: string | null | undefined, ip: string | null | undefined): DeviceDescription;
}

/** La firma HMAC de un request mobile: `HMAC(timestamp:method:path, secret)`. */
export interface RequestSigner {
  sign(timestamp: string, method: string, path: string, secret: string): string;
  /** Comparación en tiempo constante. */
  matches(received: string, expected: string): boolean;
}

/** Las API keys de los sistemas externos (comparación en tiempo constante). */
export interface ApiKeyVerifier {
  isValid(apiKey: string | undefined): apiKey is string;
}

/** ¿Un error inesperado se re-lanza tal cual (ya dice qué responder, o es temporal de la base) o se envuelve? */
export interface ErrorPolicy {
  shouldPropagate(error: unknown): boolean;
}

/** El contexto de la operación en curso: al autenticar se le agrega la sesión y el usuario (para la auditoría). */
export interface OperationSession {
  bind(sessionId: string | null, userId: string | null): void;
}
