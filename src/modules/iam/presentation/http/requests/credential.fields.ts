// Campos de credenciales (contraseña, códigos MFA, reset) con los mismos mensajes y pistas que tenía
// BaseValidator. La política de contraseñas vive en shared (la usa también person).
import { z, withHint } from '../../../../../shared/presentation/validation/z';
import { newPassword, password } from '../../../../../shared/presentation/validation/password.fields';

export { newPassword, password };

const sixDigits = (requiredMessage: string, label: string, hint: string) =>
  withHint(
    z
      .string({ error: requiredMessage })
      .trim()
      .min(1, { error: requiredMessage })
      .length(6, { error: `${label} debe tener exactamente 6 dígitos` })
      .regex(/^\d+$/, { error: `${label} debe contener solo números` }),
    { hint }
  );

export const totpCode = () => sixDigits('El código TOTP es requerido', 'El código', 'Ingresá el código de 6 dígitos numéricos de tu app de autenticación');
export const optionalSixDigitCode = (label: string) => sixDigits(`${label} es requerido`, label, 'Ingresá el código de 6 dígitos').optional();

export const resetToken = () =>
  withHint(
    z
      .string({ error: 'El token es requerido' })
      .trim()
      .min(1, { error: 'El token es requerido' })
      .length(64, { error: 'El token debe tener 64 caracteres' }),
    { hint: 'Pegá el token de 64 caracteres que recibiste' }
  );

export const resetType = () =>
  withHint(
    z
      .string({ error: 'El tipo de reset es requerido' })
      .trim()
      .min(1, { error: 'El tipo de reset es requerido' })
      .pipe(z.enum(['password', 'mfa'], { error: 'El tipo debe ser "password" o "mfa"' })),
    { hint: 'Indicá "password" o "mfa"' }
  );

/** Header X-Client-Type: web | mobile. */
export const clientTypeHeader = () =>
  withHint(
    z
      .string({ error: 'X-Client-Type es requerido' })
      .min(1, { error: 'X-Client-Type es requerido' })
      .pipe(z.enum(['web', 'mobile'], { error: 'X-Client-Type debe ser web o mobile' })),
    { hint: 'Indicá web o mobile' }
  );

export default { password, newPassword, totpCode, optionalSixDigitCode, resetToken, resetType, clientTypeHeader };
