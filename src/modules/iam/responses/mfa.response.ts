import { z } from '../../../shared/validation/z';
import { dateTime } from '../../../shared/validation/output';
/**
 * ============================================================
 * MFA DTOs — CLIENT
 * ============================================================
 * DTOs simples — no usan componentes del shared porque
 * no mapean directamente a entidades de BD.
 */

/** Campos que exponen las respuestas de MFA. */
interface MfaFields {
  userId: string;
  username: string | null;
  otpauthUrl: string;
  secretCode: string;
  valid: boolean;
  totpEnabled: boolean;
  smsMfaEnabled: boolean;
  preferredMfaMethod: string;
  verificationCodeId: string;
  expiresAt: Date;
  truncatedCode: string | null;
}

function TOTPSetupResponseDTO({ otpauthUrl, secretCode, username }: Pick<MfaFields, 'otpauthUrl' | 'secretCode' | 'username'>) {
  return {
    otpauthUrl,
    secretCode,
    username,
    instructions:
      'Escanea el código QR con tu aplicación de autenticación ' +
      '(Google Authenticator, Authy, etc.) y verifica el código generado para activar TOTP.'
  };
}

function TOTPActivationResponseDTO({ userId, username, totpEnabled }: Pick<MfaFields, 'userId' | 'username' | 'totpEnabled'>) {
  return { userId, username, totpEnabled };
}

function TOTPVerificationResponseDTO({ valid, username }: Pick<MfaFields, 'valid' | 'username'>) {
  return { valid, username };
}

function PasswordValidationResponseDTO({ valid, username }: Pick<MfaFields, 'valid' | 'username'>) {
  return { valid, username };
}

function SMSMFAActivationResponseDTO({
  userId,
  username,
  smsMfaEnabled
}: Pick<MfaFields, 'userId' | 'username' | 'smsMfaEnabled'>) {
  return { userId, username, smsMfaEnabled };
}

function PreferredMethodResponseDTO({
  userId,
  username,
  preferredMfaMethod
}: Pick<MfaFields, 'userId' | 'username' | 'preferredMfaMethod'>) {
  return { userId, username, preferredMfaMethod };
}

function MFAStatusResponseDTO({
  userId,
  username,
  totpEnabled,
  smsMfaEnabled,
  preferredMfaMethod
}: Pick<MfaFields, 'userId' | 'username' | 'totpEnabled' | 'smsMfaEnabled' | 'preferredMfaMethod'>) {
  return { userId, username, totpEnabled, smsMfaEnabled, preferredMfaMethod };
}

function SMSActivationRequestResponseDTO({
  verificationCodeId,
  expiresAt,
  truncatedCode
}: Pick<MfaFields, 'verificationCodeId' | 'expiresAt' | 'truncatedCode'>) {
  return { verificationCodeId, expiresAt, truncatedCode };
}

export default {
  TOTPSetupResponseDTO,
  TOTPActivationResponseDTO,
  TOTPVerificationResponseDTO,
  PasswordValidationResponseDTO,
  SMSMFAActivationResponseDTO,
  SMSActivationRequestResponseDTO,
  MFAStatusResponseDTO,
  PreferredMethodResponseDTO
};

// ── Esquemas de salida ──
const account = { userId: z.uuid(), username: z.string().nullable() };
const mfaMethod = z.string().meta({ example: 'totp', description: 'none | totp | sms' });

export const TotpSetupSchema = z.object({
  otpauthUrl: z.string().meta({ description: 'URL otpauth:// para generar el código QR.' }),
  secretCode: z.string().meta({ description: 'Secreto para ingresar a mano en la app de autenticación.' }),
  username: z.string().nullable(),
  instructions: z.string()
});
export const TotpActivationSchema = z.object({ ...account, totpEnabled: z.boolean() });
export const ValidationResultSchema = z.object({ valid: z.boolean(), username: z.string().nullable() });
export const SmsMfaActivationSchema = z.object({ ...account, smsMfaEnabled: z.boolean() });
export const PreferredMethodSchema = z.object({ ...account, preferredMfaMethod: mfaMethod });
export const MfaStatusSchema = z.object({
  ...account,
  totpEnabled: z.boolean(),
  smsMfaEnabled: z.boolean(),
  preferredMfaMethod: mfaMethod
});
export const SmsActivationRequestSchema = z.object({
  verificationCodeId: z.uuid(),
  expiresAt: dateTime(),
  truncatedCode: z.string().nullable().meta({ description: 'Código parcial. Solo fuera de producción, para pruebas.' })
});
