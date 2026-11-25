// Esquemas de salida (Zod) de la gestión de usuarios internos.
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';
import { PersonSchema, UserSchema } from '../../../../../shared/presentation/validation/account.schemas';

export const InternalUserSchema = z.object({
  userId: z.uuid(),
  username: z.string(),
  isActive: z.boolean().nullable(),
  deletedAt: dateTime().nullable(),
  totpEnabled: z.boolean().nullable(),
  smsMfaEnabled: z.boolean(),
  preferredMfaMethod: z.string(),
  role: UserSchema.shape.role.unwrap().nullable(),
  person: PersonSchema.nullable(),
  createdAt: dateTime(),
  updatedAt: dateTime()
});

export const InternalUserListItemSchema = z.object({
  userId: z.uuid(),
  username: z.string(),
  isActive: z.boolean().nullable(),
  deletedAt: dateTime().nullable(),
  roleName: z.string().nullable().meta({ example: 'ADMIN_PRODUCTOS' }),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable().meta({ description: 'Correo enmascarado.' }),
  pendingApproval: z.unknown().meta({ description: 'Solicitud de doble aprobación pendiente sobre el usuario, o null.' }),
  createdAt: dateTime(),
  updatedAt: dateTime()
});

export const InternalUserCreatedSchema = InternalUserSchema.extend({
  temporaryPassword: z.string().meta({ description: 'Contraseña temporal: se muestra una sola vez.' })
});

export const RoleOptionSchema = z.object({ roleId: z.uuid(), name: z.string(), description: z.string().nullable() });

// Resultados armados en el service (sin función DTO)
export const InternalUserDeletedSchema = z.object({ userId: z.uuid(), deleted: z.literal(true) });
export type InternalUserDeleted = z.infer<typeof InternalUserDeletedSchema>;
export const InternalUserSessionsClosedSchema = z.object({ userId: z.uuid(), closed: z.literal(true) });
export type InternalUserSessionsClosed = z.infer<typeof InternalUserSessionsClosedSchema>;
