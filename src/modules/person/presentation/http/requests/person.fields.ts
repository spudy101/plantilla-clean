// Campos de una persona (documento, nombres, nacimiento, teléfono, dirección) con los mismos mensajes y pistas
// que tenía BaseValidator. Los usan los requests de este módulo y de iam (a través del index de person).
import { z, withHint } from '../../../../../shared/presentation/validation/z';

const NAME_REGEX = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'-]+$/;
const NAME_HINT = 'Usá entre 2 y 50 caracteres, solo letras y espacios';

/** Número de documento: 4 a 20 caracteres. */
export const nationalId = () =>
  withHint(
    z
      .string({ error: 'El número de documento es requerido' })
      .trim()
      .min(1, { error: 'El número de documento es requerido' })
      .min(4, { error: 'El número de documento debe tener entre 4 y 20 caracteres' })
      .max(20, { error: 'El número de documento debe tener entre 4 y 20 caracteres' }),
    { hint: 'Ingresá entre 4 y 20 dígitos sin espacios ni guiones' }
  );

/** Nombre o apellido: 2 a 50 letras. `label` en minúscula: "nombre", "apellido", "segundo nombre"… */
const name = (label: string) =>
  z
    .string({ error: `El ${label} es requerido` })
    .trim()
    .min(1, { error: `El ${label} es requerido` })
    .min(2, { error: `El ${label} debe tener entre 2 y 50 caracteres` })
    .max(50, { error: `El ${label} debe tener entre 2 y 50 caracteres` })
    .regex(NAME_REGEX, { error: `El ${label} solo puede contener letras` });

export const firstName = () => withHint(name('nombre'), { hint: NAME_HINT });
export const lastName = () => withHint(name('apellido'), { hint: NAME_HINT });
export const optionalMiddleName = () => withHint(name('segundo nombre').nullish(), { hint: NAME_HINT });
export const optionalSecondLastName = () => withHint(name('segundo apellido').nullish(), { hint: NAME_HINT });

const BIRTH_DATE_ERROR = 'La fecha de nacimiento debe ser una fecha válida (YYYY-MM-DD)';
/** Fecha de nacimiento opcional → Date. */
export const optionalBirthDate = () =>
  withHint(
    z
      .string({ error: BIRTH_DATE_ERROR })
      .refine(s => /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s)), { error: BIRTH_DATE_ERROR })
      .transform(s => new Date(s))
      .nullish(),
    { hint: 'Ingresá una fecha de nacimiento válida en formato YYYY-MM-DD' }
  );

/** Teléfono: 6 a 15 dígitos. */
export const phone = (label = 'El teléfono') =>
  withHint(
    z
      .string({ error: `${label} es requerido` })
      .trim()
      .min(1, { error: `${label} es requerido` })
      .regex(/^\d{6,15}$/, { error: `${label} debe contener entre 6 y 15 dígitos` }),
    { hint: 'Ingresá un número de teléfono válido con código de país' }
  );

/** Contraseña actual (para confirmar una operación sensible): solo presencia. */
export const currentPassword = (label = 'La contraseña actual') =>
  withHint(z.string({ error: issue => (issue.input === undefined ? `${label} es requerida` : 'La contraseña debe ser una cadena de texto') }).min(1, { error: `${label} es requerida` }), {
    hint: 'Ingresá tu contraseña actual'
  });

export default { nationalId, firstName, lastName, optionalMiddleName, optionalSecondLastName, optionalBirthDate, phone, currentPassword };
