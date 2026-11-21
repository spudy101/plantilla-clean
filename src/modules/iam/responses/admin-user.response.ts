import { z } from '../../../shared/presentation/validation/z';
import { dateTime } from '../../../shared/presentation/validation/output';
import type { Role } from '../../../shared/infrastructure/database/generated/prisma/client';

import personModule from '../../person';
const { personComponentsDto: componentsPersonModule } = personModule;
const { UserComponent, PersonComponent } = componentsPersonModule;
import componentsAuthModule from './auth-components.response';
const { UserSessionComponent, UserChangeLogComponent } = componentsAuthModule;

// ─── Detalle de usuario interno ───────────────────────────────────────────────

/** Usuario interno con persona (+ contacto) y rol; pendingApproval lo anota DualApproval. */
type InternalUserRow = NonNullable<Parameters<typeof UserComponent.build>[0]> & {
  person?: Parameters<typeof PersonComponent.build>[0];
  pendingApproval?: unknown;
};

function InternalUserDTO(user: InternalUserRow | null | undefined) {
  const u = user ? UserComponent.build(user, { includeRole: true }) : null;
  if (!user || !u) {
    return null;
  }
  const p = PersonComponent.build(user.person, { includeContact: true });

  return {
    userId: u.userId,
    username: u.username,
    isActive: u.isActive,
    deletedAt: u.deletedAt ?? null,
    totpEnabled: u.totpEnabled,
    smsMfaEnabled: u.smsMfaEnabled,
    preferredMfaMethod: u.preferredMfaMethod,
    role: u.role || null,
    person: p,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt
  };
}

// ─── Item de lista ────────────────────────────────────────────────────────────

function InternalUserListDTO(user: InternalUserRow) {
  const u = UserComponent.build(user, { includeRole: true });
  if (!u) {
    return null;
  }
  const p = PersonComponent.build(user.person, { includeContact: true });

  return {
    userId: u.userId,
    username: u.username,
    isActive: u.isActive,
    deletedAt: u.deletedAt ?? null,
    // Los componentes devuelven Record<string, unknown>: se lee la forma conocida de role/contact
    roleName: (u.role as { name?: string } | null | undefined)?.name ?? null,
    firstName: p?.firstName ?? null,
    lastName: p?.lastName ?? null,
    email: (p?.contact as { email?: string | null } | null | undefined)?.email ?? null,
    pendingApproval: user.pendingApproval ?? null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt
  };
}

// ─── Creación (incluye contraseña temporal SOLO en esta respuesta) ────────────

function InternalUserCreatedDTO(user: InternalUserRow, temporaryPassword: string) {
  return {
    ...InternalUserDTO(user),
    temporaryPassword
  };
}

// ─── Sesión ───────────────────────────────────────────────────────────────────

function UserSessionDTO(session: Parameters<typeof UserSessionComponent.build>[0]) {
  return UserSessionComponent.build(session);
}

// ─── Log de cambios (auditoría) ───────────────────────────────────────────────

function UserChangeLogDTO(log: Parameters<typeof UserChangeLogComponent.build>[0]) {
  return UserChangeLogComponent.build(log);
}

// ─── Opción de rol (para poblar el filtro por rol del listado de internos) ─────

function RoleOptionDTO(role: Pick<Role, 'roleId' | 'name' | 'description'>) {
  return {
    roleId: role.roleId,
    name: role.name,
    description: role.description ?? null
  };
}

export default {
  InternalUserDTO,
  InternalUserListDTO,
  InternalUserCreatedDTO,
  UserSessionDTO,
  UserChangeLogDTO,
  RoleOptionDTO
};

// ── Esquemas de salida ──
const { UserSchema, PersonSchema } = personModule.personSchemas;

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
