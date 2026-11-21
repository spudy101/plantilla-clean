// Campos de credenciales (contraseña, códigos MFA, reset) con los mismos mensajes y pistas que tenía
// BaseValidator. Los usan los requests de iam y de person (a través del index de iam).
import { z, withHint } from '../../../shared/presentation/validation/z';
import constantsModule from '../../../shared/infrastructure/config';
const { REGEX } = constantsModule;

const POLICY_HINT = 'Incluí mayúsculas, minúsculas, números y un carácter especial';
const NEW_POLICY_HINT = 'Usá al menos 10 caracteres con mayúsculas, minúsculas, números y un carácter especial';

// [RF-AUTH-01] | CA-05 | Mínimo 10 caracteres + complejidad (mayúscula, minúscula, número, especial).
const policy = (label: string, requiredMessage: string) =>
  z
    .string({ error: requiredMessage })
    .min(1, { error: requiredMessage })
    .min(10, { error: `${label} debe tener al menos 10 caracteres` })
    .regex(REGEX.PASSWORD, { error: `${label} debe contener al menos una mayúscula, una minúscula, un número y un carácter especial` });

export const password = () => withHint(policy('La contraseña', 'La contraseña es requerida'), { hint: POLICY_HINT });
export const newPassword = () => withHint(policy('La nueva contraseña', 'La nueva contraseña es requerida'), { hint: NEW_POLICY_HINT });

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
