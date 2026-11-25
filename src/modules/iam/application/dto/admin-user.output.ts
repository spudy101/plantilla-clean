// Salidas de la gestión de usuarios internos.
import { toPersonOutput, toUserOutput } from '../../../../shared/application/account-views';
import type { RoleRef } from '../../domain/user';
import componentsAuthModule from './auth-components.output';
const { UserSessionComponent, UserChangeLogComponent } = componentsAuthModule;

const UserComponent = { build: toUserOutput };
const PersonComponent = { build: toPersonOutput };

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

function RoleOptionDTO(role: Pick<RoleRef, 'roleId' | 'name' | 'description'>) {
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


export interface InternalUserDeleted {
  userId: string;
  deleted: true;
}

export interface InternalUserSessionsClosed {
  userId: string;
  closed: true;
}
