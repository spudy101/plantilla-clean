// Entrada del módulo person: administración de clientes (admin), perfil propio y referencias personales.
import { z, withHint } from '../../../../../shared/presentation/validation/z';
import { email, input, optionalBool, optionalUuid, pageQuery, searchQuery, uuid } from '../../../../../shared/presentation/validation/fields';
import { currentPassword, firstName, lastName, nationalId, optionalBirthDate, optionalMiddleName, optionalSecondLastName, phone } from '../../../../../shared/presentation/validation/identity.fields';
import { newPassword } from '../../../../../shared/presentation/validation/password.fields';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Administración de clientes (admin) ────────────────────────
export const PersonListQuery = z.object({
  ...pageQuery(['createdAt', 'updatedAt', 'username', 'isActive'], { sortBy: 'createdAt' }),
  ...searchQuery,
  roleId: z
    .string()
    .refine(v => v.split(',').every(id => UUID_REGEX.test(id.trim())), { error: 'roleId debe ser un UUID o lista de UUIDs válidos separados por coma' })
    .optional(),
  nationalId: withHint(z.string().trim().min(1, { error: 'nationalId no puede estar vacío' }).optional(), {
    hint: 'Ingresá el número de documento completo para la búsqueda exacta'
  }),
  userId: withHint(z.uuid({ error: 'userId debe ser un UUID válido' }).optional(), { hint: 'Filtrá por el identificador exacto del usuario' }),
  isActive: optionalBool('El estado')
});
export type PersonListQuery = z.output<typeof PersonListQuery>;
/** Clientes eliminados (histórico): sin filtros de estado ni de rol, y ordenables por fecha de baja. */
export const DeletedPersonListQuery = z.object({
  ...pageQuery(['createdAt', 'deletedAt', 'username'], { sortBy: 'createdAt' }),
  ...searchQuery
});
export type DeletedPersonListQuery = z.output<typeof DeletedPersonListQuery>;

export const PersonUserIdParams = input({ userId: uuid('userId') });

const NAME_100_HINT = 'Usá entre 2 y 100 caracteres';
const name100 = (field: string) =>
  withHint(
    z
      .string({ error: `${field} es requerido` })
      .trim()
      .min(1, { error: `${field} es requerido` })
      .min(2, { error: `${field} debe tener entre 2 y 100 caracteres` })
      .max(100, { error: `${field} debe tener entre 2 y 100 caracteres` }),
    { hint: NAME_100_HINT }
  );
const optionalName100 = (field: string) =>
  withHint(
    z
      .string()
      .trim()
      .min(2, { error: `${field} debe tener entre 2 y 100 caracteres` })
      .max(100, { error: `${field} debe tener entre 2 y 100 caracteres` })
      .nullish(),
    { hint: NAME_100_HINT }
  );

export const CreatePersonBody = input({
  nationalId: nationalId(),
  email: email(),
  firstName: name100('firstName'),
  middleName: optionalName100('middleName'),
  lastName: name100('lastName'),
  secondLastName: optionalName100('secondLastName'),
  documentTypeId: uuid('documentTypeId'),
  birthDate: optionalBirthDate(),
  genderId: optionalUuid('genderId'),
  countryId: optionalUuid('countryId')
});

export const ChangeEmailBody = input({
  newEmail: withHint(
    z
      .string({ error: 'newEmail es requerido' })
      .trim()
      .min(1, { error: 'newEmail es requerido' })
      .max(255, { error: 'newEmail debe tener máximo 255 caracteres' })
      .pipe(z.email({ error: 'newEmail debe ser un email válido' }))
      .transform(v => v.toLowerCase()),
    { hint: 'Ingresá un correo válido, por ejemplo usuario@dominio.com' }
  )
});
export const ChangeNationalIdBody = input({ newNationalId: nationalId() });
export const ChangeRoleBody = input({ newRoleId: uuid('newRoleId') });
export const AdminDeleteAccountBody = input({
  currentPassword: withHint(z.string({ error: 'currentPassword es requerido' }).trim().min(1, { error: 'currentPassword es requerido' }), {
    hint: 'Ingresá tu contraseña actual para confirmar la operación'
  })
});

// ── Referencias personales ────────────────────────────────────
const REFERENCE_PHONE = /^\+?[\d\s\-()]{7,20}$/;
const REFERENCE_PHONE_HINT = 'Ingresá un teléfono válido (7 a 20 dígitos, se permiten + espacios y guiones)';
const referenceName = z
  .string({ error: 'El nombre de la referencia es requerido' })
  .trim()
  .min(1, { error: 'El nombre de la referencia es requerido' })
  .min(2, { error: 'El nombre debe tener entre 2 y 200 caracteres' })
  .max(200, { error: 'El nombre debe tener entre 2 y 200 caracteres' });
const referencePhone = z
  .string({ error: 'El teléfono de la referencia es requerido' })
  .trim()
  .min(1, { error: 'El teléfono de la referencia es requerido' })
  .regex(REFERENCE_PHONE, { error: 'El teléfono no tiene un formato válido' });
const referenceType = z.enum(['conocido', 'familiar'], {
  error: issue => (issue.input === undefined || issue.input === '' ? 'El tipo de referencia es requerido' : 'El tipo debe ser "conocido" o "familiar"')
});

export const CreateReferenceBody = input({
  referenceName: withHint(referenceName, { hint: 'Usá entre 2 y 200 caracteres' }),
  referencePhone: withHint(referencePhone, { hint: REFERENCE_PHONE_HINT }),
  referenceType: withHint(referenceType, { hint: 'Indicá uno de: conocido, familiar' })
});
export const UpdateReferenceBody = input({
  referenceName: withHint(referenceName.optional(), { hint: 'Usá entre 2 y 200 caracteres' }),
  referencePhone: withHint(referencePhone.optional(), { hint: REFERENCE_PHONE_HINT }),
  referenceType: withHint(referenceType.optional(), { hint: 'Indicá uno de: conocido, familiar' })
});
export const ReferenceIdParams = input({ referenceId: uuid('La referencia') });

// ── Perfil propio ─────────────────────────────────────────────
const USERNAME_HINT = 'Usá entre 3 y 30 caracteres: letras, números y guiones bajos';
const PROFILE_FIELDS = ['username', 'avatarId', 'genderId', 'location', 'birthDate'] as const;

const Location = z.looseObject({
  departmentId: withHint(z.uuid({ error: 'El departamento debe ser un UUID válido' }).nullish(), { hint: 'El identificador debe ser un UUID válido' }),
  cityId: withHint(z.uuid({ error: 'La ciudad debe ser un UUID válido' }).nullish(), { hint: 'El identificador debe ser un UUID válido' }),
  address: withHint(
    z
      .string({ error: 'La dirección es requerida' })
      .trim()
      .min(1, { error: 'La dirección es requerida' })
      .min(5, { error: 'La dirección debe tener entre 5 y 150 caracteres' })
      .max(150, { error: 'La dirección debe tener entre 5 y 150 caracteres' }),
    { hint: 'Ingresá una dirección de entre 5 y 150 caracteres' }
  ),
  postalCode: withHint(z.string().trim().regex(/^\d{4,10}$/, { error: 'El código postal debe contener entre 4 y 10 dígitos' }).nullish(), {
    hint: 'Ingresá un código postal de 4 a 10 dígitos'
  }),
  type: withHint(
    z
      .string({ error: 'El tipo de vivienda debe ser una cadena de texto' })
      .max(40, { error: 'El tipo de vivienda no puede exceder 40 caracteres' })
      .optional(),
    { hint: 'Ingresá el tipo de vivienda, máximo 40 caracteres' }
  )
}).superRefine((loc, ctx) => {
  const missing = (['departmentId', 'cityId', 'address'] as const).filter(f => !loc[f]);
  if (missing.length > 0) {
    ctx.addIssue({ code: 'custom', message: `Si envía location, los siguientes campos son obligatorios: ${missing.join(', ')}` });
  }
});

export const UpdateProfileBody = input({
  username: withHint(
    z
      .string({ error: 'El username debe ser una cadena de texto' })
      .trim()
      .min(3, { error: 'El username debe tener entre 3 y 30 caracteres' })
      .max(30, { error: 'El username debe tener entre 3 y 30 caracteres' })
      .regex(/^\w+$/, { error: 'El username solo puede contener letras, números y guiones bajos' })
      .optional(),
    { hint: USERNAME_HINT }
  ),
  avatarId: optionalUuid('El avatar'),
  genderId: optionalUuid('El género'),
  location: Location.optional(),
  birthDate: optionalBirthDate()
}).refine(
  v => PROFILE_FIELDS.some(f => (f === 'location' ? v.location && Object.keys(v.location).length > 0 : (v as Record<string, unknown>)[f] !== undefined)),
  { error: 'Debe enviar al menos un campo para actualizar el perfil' }
);

export const UpdateEmailBody = input({ email: email(), currentPassword: currentPassword() });

export const UpdatePhoneBody = input({
  newPhone: phone('El teléfono'),
  phonePrefixId: uuid('El prefijo telefónico'),
  phoneType: withHint(
    z.enum(['primary', 'secondary'], {
      error: issue => (issue.input === undefined || issue.input === '' ? 'El tipo de teléfono es requerido' : 'El tipo debe ser "primary" o "secondary"')
    }),
    { hint: 'Indicá primary o secondary' }
  )
});

export const UpdatePasswordBody = input({
  currentPassword: currentPassword(),
  newPassword: newPassword()
});

export const UpdateNamesBody = input({
  firstName: firstName(),
  middleName: optionalMiddleName(),
  lastName: lastName(),
  secondLastName: optionalSecondLastName()
});

export const DeleteAccountBody = input({ currentPassword: currentPassword() });
