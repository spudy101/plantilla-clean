// Códigos OTP de verificación de un contacto (email o teléfono): vigencia, intentos y qué se muestra del código.
import { CodeAlreadyUsedError, InvalidCodeError, TooManyCodeAttemptsError } from './errors';

export type ContactType = 'email' | 'phone';
/** Los tipos que guarda la tabla (los de contacto + los de otros flujos, como la firma de contrato). */
export type VerificationCodeType = string;

// [RF-AUTH-01] | CA-02 | 🔄 MODIFICADO: CA-02 especifica TTL 24h. Implementado en 15 min por criterio de
// seguridad (OTP numérico en flujo activo). Pendiente: actualizar SRS v12.1.
export const VERIFICATION_EXPIRATION_MINUTES = 15;
export const MAX_VERIFICATION_ATTEMPTS = 5;
/** Rango del código numérico de 6 dígitos (el máximo no se incluye). */
export const VERIFICATION_CODE_RANGE = { min: 100000, max: 999999 } as const;
/** Código fijo cuando los proveedores externos están simulados (no hay SMS/email real). */
export const MOCK_VERIFICATION_CODE = '123456';
const MASKED_CODE_VISIBLE_DIGITS = 2;

export interface VerificationCode {
  verificationCodeId: string;
  type: VerificationCodeType;
  contactValue: string;
  code: string;
  /** Nullable en la columna (default 0). */
  attempts: number | null;
  expiresAt: Date;
  verifiedAt: Date | null;
  originSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const expirationFrom = (now = Date.now()): Date => new Date(now + VERIFICATION_EXPIRATION_MINUTES * 60 * 1000);

/**
 * Compara el código ingresado. Lanza si ya se usó o si se agotaron los intentos; devuelve si coincide. Un
 * fallo lo cuenta quien llama (`attempts + 1`) y lo reporta con `wrongCodeError`.
 */
export function checkCode(verificationCode: Pick<VerificationCode, 'verifiedAt' | 'attempts' | 'code'>, code: string): boolean {
  if (verificationCode.verifiedAt) {
    throw new CodeAlreadyUsedError();
  }
  if ((verificationCode.attempts ?? 0) >= MAX_VERIFICATION_ATTEMPTS) {
    throw new TooManyCodeAttemptsError();
  }
  return verificationCode.code === code;
}

/** El error de un código equivocado, con los intentos que quedan tras contar este. */
export const wrongCodeError = (attemptsSoFar: number) => new InvalidCodeError(MAX_VERIFICATION_ATTEMPTS - (attemptsSoFar + 1));

/** Lo que se devuelve del código: los últimos dígitos si es por SMS (o simulado, para pruebas); si no, nada. */
export function truncatedCode(type: ContactType, code: string, mockProviders: boolean): string | null {
  if (type === 'phone' || mockProviders) {
    return `****${code.slice(-MASKED_CODE_VISIBLE_DIGITS)}`;
  }
  return null;
}

/** El texto del SMS con el código. */
export const verificationSmsText = (code: string) =>
  `Tu código de verificación es ${code}. Vence en ${VERIFICATION_EXPIRATION_MINUTES} minutos.`;
