// Esquemas de salida (Zod) del panel de clientes: documentan lo que arma application/dto/admin-person.output.ts.
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';
import piiMaskingDoc from '../../../../../shared/presentation/validation/pii-masking.doc';
import { PersonSchema, UserSchema } from './person-components.response';

const { MASKED_DOCUMENT_DESC, MASKED_EMAIL_DESC } = piiMaskingDoc;
const maskedEmail = z.string().nullable().meta({ example: '****n@example.com', description: MASKED_EMAIL_DESC });
const userRef = { userId: z.uuid(), username: z.string().meta({ example: 'jperez' }) };

/** Un rol, con el mismo formato que el catálogo de roles. */
export const RoleSchema = z.object({
  roleId: z.uuid(),
  description: z.string().nullable(),
  name: z.string().nullish(),
  isActive: z.boolean().nullish(),
  createdAt: dateTime().nullish(),
  updatedAt: dateTime().nullish()
});

export const AdminUserDetailSchema = z.object({
  user: UserSchema.nullable(),
  person: PersonSchema.nullable().optional()
});

export const AdminUserListItemSchema = z.object({
  ...userRef,
  isActive: z.boolean().nullable(),
  deletedAt: dateTime().nullable(),
  totpEnabled: z.boolean().nullable(),
  smsMfaEnabled: z.boolean(),
  preferredMfaMethod: z.string().meta({ example: 'none', description: 'none | totp | sms' }),
  createdAt: dateTime(),
  person: z
    .object({
      firstName: z.string(),
      lastName: z.string(),
      nationalId: z.string().nullable().meta({ example: '******4050', description: MASKED_DOCUMENT_DESC })
    })
    .optional(),
  email: maskedEmail.optional(),
  emailVerified: z.boolean().optional(),
  role: RoleSchema.nullable().optional()
});

export const AdminUserCreatedSchema = z.object({
  user: AdminUserDetailSchema,
  temporaryPassword: z
    .string()
    .meta({ description: 'Contraseña temporal: se muestra una sola vez y debe cambiarse al ingresar.' })
});

export const AdminPasswordResetSchema = z.object({ ...userRef, email: maskedEmail });

export const AdminEmailChangedSchema = z.object({
  ...userRef,
  oldEmail: maskedEmail,
  newEmail: maskedEmail,
  emailVerified: z.literal(true)
});

export const AdminNationalIdChangedSchema = z.object({
  ...userRef,
  oldNationalId: z.string().nullable().meta({ description: MASKED_DOCUMENT_DESC }),
  newNationalId: z.string().nullable().meta({ description: MASKED_DOCUMENT_DESC })
});

export const AdminUserStatusSchema = z.object({
  ...userRef,
  isActive: z.boolean().nullable(),
  action: z.enum(['activate', 'deactivate'])
});

export const AdminMfaDisabledSchema = z.object({
  ...userRef,
  totpEnabled: z.boolean().nullable(),
  smsMfaEnabled: z.boolean(),
  preferredMfaMethod: z.string()
});

export const AdminRoleChangedSchema = z.object({ ...userRef, oldRole: RoleSchema.nullable(), newRole: RoleSchema.nullable() });
