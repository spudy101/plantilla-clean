// Entrada del módulo iam: login, registro, MFA, biometría, dispositivos, sesiones, RBAC y usuarios internos.
import { z, withHint } from '../../../../../shared/presentation/validation/z';
import {
  email,
  flexibleBool,
  input,
  optionalBool,
  optionalInList,
  optionalIsoDate,
  optionalUuid,
  pageQuery,
  searchQuery,
  uuid
} from '../../../../../shared/presentation/validation/fields';
import {
  clientTypeHeader,
  newPassword,
  optionalSixDigitCode,
  password,
  resetToken,
  resetType,
  totpCode
} from './credential.fields';
import rbacModule from '../../../../../shared/domain/constants/rbac';
import personFields from '../../../../../shared/presentation/validation/identity.fields';
const { RBAC_ROLES, RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

const required = (message: string, hint: string) =>
  withHint(z.string({ error: message }).trim().min(1, { error: message }), { hint });
const valuesOf = (field: string, values: readonly string[]) =>
  optionalInList(values, {
    message: `${field} debe ser: ${values.join(', ')}`,
    hint: `Indicá uno de los valores: ${values.join(', ')}`
  });
const acceptPolicy = withHint(z.boolean({ error: 'acceptPolicy debe ser verdadero o falso' }).optional(), {
  hint: 'Ingresá true o false'
});

// ── Login y sesión ────────────────────────────────────────────
export const ClientTypeHeaders = input({ 'x-client-type': clientTypeHeader() });

export const LoginBody = input({
  nationalId: personFields.nationalId(),
  password: password(),
  pushToken: withHint(z.string({ error: 'pushToken debe ser un string' }).optional(), {
    hint: 'Ingresá el token de push como texto'
  }),
  pushDeviceId: withHint(z.string({ error: 'pushDeviceId debe ser un string' }).optional(), {
    hint: 'Ingresá el ID del dispositivo como texto'
  }),
  pushPlatform: withHint(z.enum(['android', 'ios'], { error: 'pushPlatform debe ser android o ios' }).optional(), {
    hint: 'Indicá android o ios'
  }),
  acceptPolicy
});

export const VerifyMfaBody = input({
  nationalId: personFields.nationalId(),
  totpCode: optionalSixDigitCode('El código TOTP'),
  smsCode: optionalSixDigitCode('El código SMS'),
  session: required('La sesión es requerida', 'Reenviá el identificador de sesión recibido en el login'),
  acceptPolicy
}).refine(v => Boolean(v.totpCode || v.smsCode), { error: 'Se requiere totpCode o smsCode' });

export const RefreshTokenHeaders = input({
  'x-client-type': clientTypeHeader(),
  'x-refresh-token': z.string().optional()
}).superRefine((h, ctx) => {
  if (h['x-client-type'] === 'mobile' && !h['x-refresh-token']) {
    ctx.addIssue({ code: 'custom', path: ['x-refresh-token'], message: 'X-Refresh-Token es requerido para mobile' });
  }
});

export const DeviceIdParams = input({ deviceId: uuid('El ID del dispositivo') });
export const RenameDeviceBody = input({
  deviceName: withHint(
    z
      .string({ error: 'El nombre del dispositivo es requerido' })
      .trim()
      .min(1, { error: 'El nombre del dispositivo es requerido' })
      .max(100, { error: 'El nombre debe tener entre 1 y 100 caracteres' }),
    { hint: 'Ingresá un nombre de entre 1 y 100 caracteres' }
  )
});
export const SessionIdParams = input({ sessionId: uuid('El ID de sesión') });

// ── Registro y recuperación de credenciales ──────────────────
export const RegisterBody = input({
  email: email(),
  password: password(),
  firstName: personFields.firstName(),
  middleName: personFields.optionalMiddleName(),
  lastName: personFields.lastName(),
  secondLastName: personFields.optionalSecondLastName(),
  birthDate: personFields.optionalBirthDate(),
  nationalId: personFields.nationalId(),
  documentTypeId: uuid('El tipo de documento'),
  genderId: optionalUuid('El género'),
  countryId: optionalUuid('El país de nacionalidad'),
  acceptedPrivacyPolicy: withHint(
    flexibleBool('El campo acceptedPrivacyPolicy').refine(v => v === true, {
      error: 'Debes aceptar la política de privacidad para registrarte'
    }),
    { hint: 'Enviá true para aceptar la política de privacidad' }
  ),
  comunicacionesComerciales: optionalBool('El campo comunicacionesComerciales')
});
export const RegisterHeaders = ClientTypeHeaders;

export const RequestResetBody = input({ email: email(), type: resetType() });
export const ConfirmResetBody = input({
  token: resetToken(),
  type: resetType(),
  newPassword: z.string().optional()
}).superRefine((v, ctx) => {
  if (v.type !== 'password') {
    return;
  }
  const result = newPassword().safeParse(v.newPassword);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    ctx.addIssue({
      code: 'custom',
      path: ['newPassword'],
      message:
        v.newPassword === undefined || v.newPassword === ''
          ? 'La nueva contraseña es requerida para reset de tipo password'
          : issue.message
    });
  }
});

// ── MFA ───────────────────────────────────────────────────────
export const TotpCodeBody = input({ totpCode: totpCode() });
export const PasswordBody = input({ password: password() });
export const SmsActivationCodeBody = input({
  code: withHint(
    z
      .string({ error: 'El código de verificación es requerido' })
      .trim()
      .min(1, { error: 'El código de verificación es requerido' })
      .regex(/^\d{6}$/, { error: 'El código debe ser de 6 dígitos numéricos' }),
    { hint: 'Ingresá el código de 6 dígitos' }
  )
});
export const PreferredMethodBody = input({
  preferredMethod: withHint(
    z.enum(['none', 'totp', 'sms'], {
      error: issue =>
        issue.input === undefined || issue.input === ''
          ? 'El método preferido es requerido'
          : 'El método debe ser "none", "totp" o "sms"'
    }),
    { hint: 'Indicá none, totp o sms' }
  )
});

// ── Biometría ─────────────────────────────────────────────────
const authenticatorField = (message: string, hint: string) => required(message, hint);
export const BiometricRegisterFinishBody = input({
  credentialId: authenticatorField('El credentialId es requerido', 'Incluí el credentialId devuelto por el autenticador'),
  publicKey: authenticatorField('La llave pública es requerida', 'Incluí la llave pública generada por el autenticador'),
  challenge: authenticatorField('El challenge es requerido', 'Incluí el challenge recibido al iniciar el registro'),
  signature: authenticatorField('La firma es requerida', 'Incluí la firma generada por el autenticador')
});
export const BiometricLoginStartBody = input({ nationalId: personFields.nationalId() });
export const BiometricLoginFinishBody = input({
  credentialId: authenticatorField('El credentialId es requerido', 'Incluí el credentialId devuelto por el autenticador'),
  challenge: authenticatorField('El challenge es requerido', 'Incluí el challenge recibido al iniciar el login'),
  signature: authenticatorField('La firma es requerida', 'Incluí la firma generada por el autenticador'),
  signCount: withHint(
    z.coerce
      .number({ error: 'El signCount debe ser un entero positivo' })
      .int({ error: 'El signCount debe ser un entero positivo' })
      .min(0, { error: 'El signCount debe ser un entero positivo' }),
    { hint: 'Ingresá un entero mayor o igual a 0' }
  ),
  acceptPolicy: optionalBool('acceptPolicy')
});
export const BiometricCredentialParams = input({ credentialId: uuid('El ID de la credencial biométrica') });

// ── Sesiones e intentos (admin) ───────────────────────────────
const STATUSES = ['active', 'closed'];
const SCOPES = ['all', 'login'];
const OUTCOMES = ['success', 'failure', 'warning', 'attempt'];
const dateRange = { dateFrom: optionalIsoDate('dateFrom'), dateTo: optionalIsoDate('dateTo') };

const bySessionStart = pageQuery(['startedAt'], { sortBy: 'startedAt' });
export const AdminSessionListQuery = z.object({
  ...bySessionStart,
  ...dateRange,
  sessionId: optionalUuid('El ID de sesión'),
  userId: optionalUuid('El ID de usuario'),
  status: valuesOf('status', STATUSES)
});
export type AdminSessionListQuery = z.output<typeof AdminSessionListQuery>;
export const UserIdParams = input({ userId: uuid('userId') });
export const SessionsByUserQuery = z.object({ ...bySessionStart, status: valuesOf('status', STATUSES) });
export type SessionsByUserQuery = z.output<typeof SessionsByUserQuery>;
export const RevokeSessionParams = input({ sessionId: uuid('sessionId') });
const attemptFilters = {
  ...pageQuery(['createdAt'], { sortBy: 'createdAt' }),
  ...dateRange,
  scope: valuesOf('scope', SCOPES).meta({
    description: '`all` (por defecto): todos los eventos de Autenticación; `login`: solo intentos de inicio de sesión.'
  }),
  outcome: valuesOf('outcome', OUTCOMES)
};
export const AttemptListQuery = z.object({ ...attemptFilters, userId: optionalUuid('El ID de usuario') });
export type AttemptListQuery = z.output<typeof AttemptListQuery>;
export const AttemptsByUserQuery = z.object(attemptFilters);
export type AttemptsByUserQuery = z.output<typeof AttemptsByUserQuery>;

// ── RBAC (admin) ──────────────────────────────────────────────
const roleNames = Object.values(RBAC_ROLES) as string[];
const moduleNames = Object.values(RBAC_MODULES) as string[];
const actions = Object.values(RBAC_ACTIONS) as string[];
const requiredInList = (values: readonly string[], requiredMessage: string, invalidMessage: string, hint: string) =>
  withHint(
    z
      .string({ error: requiredMessage })
      .trim()
      .min(1, { error: requiredMessage })
      .refine(v => values.includes(v), { error: invalidMessage }),
    { hint }
  );
export const RoleNameParams = input({
  roleName: requiredInList(
    roleNames,
    'El nombre del rol es requerido',
    `El rol debe ser uno de: ${roleNames.join(', ')}`,
    `Indicá uno de: ${roleNames.join(', ')}`
  )
});
export const PermissionIdParams = input({ permissionId: uuid('El ID del permiso') });
export const GrantPermissionBody = input({
  moduleName: requiredInList(
    moduleNames,
    'El módulo es requerido',
    `El módulo debe ser uno de: ${moduleNames.join(', ')}`,
    `Indicá uno de: ${moduleNames.join(', ')}`
  ),
  action: requiredInList(
    actions,
    'La acción es requerida',
    `La acción debe ser una de: ${actions.join(', ')}`,
    `Indicá una de: ${actions.join(', ')}`
  )
});

// ── Usuarios internos (admin) ─────────────────────────────────
const byUserDates = pageQuery(['createdAt', 'updatedAt'], { sortBy: 'createdAt' });
export const InternalUserListQuery = z.object({
  ...byUserDates,
  ...searchQuery,
  roleId: optionalUuid('El rol'),
  isActive: optionalBool('El estado')
});
export type InternalUserListQuery = z.output<typeof InternalUserListQuery>;
/** Eliminados (histórico): sin filtro de estado, y ordenables también por fecha de baja. */
export const InternalUserDeletedListQuery = z.object({
  ...pageQuery(['createdAt', 'deletedAt'], { sortBy: 'createdAt' }),
  ...searchQuery,
  roleId: optionalUuid('El rol')
});
export type InternalUserDeletedListQuery = z.output<typeof InternalUserDeletedListQuery>;
export const CreateInternalUserBody = input({
  firstName: personFields.firstName(),
  lastName: personFields.lastName(),
  middleName: personFields.optionalMiddleName(),
  secondLastName: personFields.optionalSecondLastName(),
  nationalId: personFields.nationalId(),
  email: email()
});
const lengthUpTo = (message: string, min: number, max: number, hint: string) =>
  withHint(
    min > 0
      ? z.string().trim().min(min, { error: message }).max(max, { error: message })
      : z.string().trim().max(max, { error: message }),
    { hint }
  );
export const UpdateInternalUserBody = input({
  firstName: lengthUpTo('El nombre debe tener entre 2 y 50 caracteres', 2, 50, 'Usá entre 2 y 50 caracteres').optional(),
  lastName: lengthUpTo('El apellido debe tener entre 2 y 50 caracteres', 2, 50, 'Usá entre 2 y 50 caracteres').optional(),
  middleName: lengthUpTo('El segundo nombre no puede superar 50 caracteres', 0, 50, 'Usá hasta 50 caracteres').nullish(),
  secondLastName: lengthUpTo('El segundo apellido no puede superar 50 caracteres', 0, 50, 'Usá hasta 50 caracteres').nullish()
});
export const ChangeInternalRoleBody = input({ roleId: uuid('El rol') });
export const ChangeStatusBody = input({
  isActive: withHint(
    z.preprocess(
      v => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v),
      z.boolean({
        error: issue => (issue.input === undefined ? 'El estado es requerido' : 'El estado debe ser un valor booleano')
      })
    ),
    { hint: 'Ingresá true o false' }
  )
});
export const UserChangeLogsQuery = z.object(pageQuery(['createdAt'], { sortBy: 'createdAt' }));
export type UserChangeLogsQuery = z.output<typeof UserChangeLogsQuery>;
export const InternalUserIdParams = input({ userId: uuid('El usuario') });
export const DeleteInternalUserBody = input({
  currentPassword: withHint(
    z.string({ error: 'currentPassword es requerido' }).trim().min(1, { error: 'currentPassword es requerido' }),
    {
      hint: 'Ingresá tu contraseña actual para confirmar la operación'
    }
  )
});
