// La política de contraseñas, con los mismos mensajes y pistas que tenía BaseValidator. La validan iam (login,
// registro, reset) y person (cambio de contraseña desde el perfil): por eso vive en shared.
import { z, withHint } from './z';
import constantsModule from '../../infrastructure/config';
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
