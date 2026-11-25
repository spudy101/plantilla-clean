// Esquemas de salida (Zod) del MFA (TOTP y SMS).
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';

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
