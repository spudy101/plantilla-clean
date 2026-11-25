// Segundo factor (TOTP o SMS). La preferencia decide qué reto pide el login; al apagar un factor, la preferencia
// cae al otro (si está activo) para no dejar al login pidiendo un factor que ya no existe.
import type { UserAccount } from './user';

/** Al activar el primer factor queda como preferido. */
export function preferredAfterEnabling(user: Pick<UserAccount, 'preferredMfaMethod'>, method: 'totp' | 'sms'): string | null {
  return user.preferredMfaMethod === 'none' ? method : null;
}

/** Al desactivar TOTP, si era el preferido cae a SMS (si está activo) o a none. */
export function preferredAfterDisablingTotp(user: Pick<UserAccount, 'preferredMfaMethod' | 'smsMfaEnabled'>): string | null {
  return user.preferredMfaMethod === 'totp' ? (user.smsMfaEnabled ? 'sms' : 'none') : null;
}

/** Al desactivar SMS, si era el preferido cae a TOTP (si está activo) o a none. */
export function preferredAfterDisablingSms(user: Pick<UserAccount, 'preferredMfaMethod' | 'totpEnabled'>): string | null {
  return user.preferredMfaMethod === 'sms' ? (user.totpEnabled ? 'totp' : 'none') : null;
}

/** El código parcial que se devuelve al pedir la activación por SMS. */
export function truncatedCode(code: string, visibleDigits = 2): string {
  return `****${code.slice(-visibleDigits)}`;
}

/** Un código OTP vigente (de notification). */
export interface OtpCode {
  verificationCodeId: string;
  code: string;
  attempts: number | null;
  verifiedAt: Date | null;
  expiresAt: Date;
}
