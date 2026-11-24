// Las cuentas de cliente vistas desde person: el usuario (que es de iam) con su persona, contacto y ubicación.
//
// Person no guarda usuarios: los lee y los cambia por el puerto ClientAccounts. Lo que vive acá son las
// formas en que los lee y las reglas que aplica el panel de clientes sobre una cuenta.
import rbacModule from '../../../shared/domain/constants/rbac';
import type { Person } from './person';
import type { PersonContactWithPrefixes } from './person-contact';
import type { PersonLocationWithPlaces } from './person-location';
import {
  AccountDeletedError,
  AccountStatusUnchangedError,
  AccountWithoutPersonError,
  MfaNotEnabledError,
  NotAClientAccountError,
  NotAClientRoleError,
  SameRoleError
} from './errors';

const { CLIENT_ROLE_NAMES } = rbacModule;

export interface RoleRef {
  roleId: string;
  name: string;
  description: string | null;
  isActive?: boolean | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AvatarRef {
  avatarId: string;
  name: string;
  imageUrl: string | null;
  theme?: { avatarThemeId: string; name: string } | null;
}

/** La persona con todo lo que muestra un perfil. */
export interface PersonProfile extends Person {
  gender: { genderId: string; name: string } | null;
  documentType: { documentTypeId: string; code: string; name: string } | null;
  country: { countryId: string; name: string; code: string; iconUrl: string | null } | null;
  contact: PersonContactWithPrefixes | null;
  location: PersonLocationWithPlaces | null;
}

/** Una cuenta con su perfil completo (detalle, listado y perfil propio). */
export interface ClientAccount {
  userId: string;
  username: string;
  personId: string;
  roleId: string;
  avatarId: string | null;
  isActive: boolean | null;
  deletedAt: Date | null;
  totpEnabled: boolean | null;
  smsMfaEnabled: boolean;
  preferredMfaMethod: string;
  privacyPolicyVersion: string | null;
  privacyPolicyAcceptedAt: Date | null;
  privacyPolicyAcceptedIp: string | null;
  createdAt: Date;
  updatedAt: Date;
  role: RoleRef | null;
  avatar: AvatarRef | null;
  person: PersonProfile | null;
}

/** Lo que necesita una acción del panel sobre una cuenta: estado, MFA, rol, nombre, documento y email. */
export interface AccountTarget {
  userId: string;
  username: string;
  roleId: string;
  isActive: boolean | null;
  deletedAt: Date | null;
  totpEnabled: boolean | null;
  smsMfaEnabled: boolean;
  preferredMfaMethod: string;
  person: {
    personId: string;
    firstName: string;
    nationalId: string | null;
    contact: { personContactId: string; email: string } | null;
  } | null;
  role: { roleId: string; name: string; description: string | null } | null;
}

/** Lo mínimo de una cuenta: para confirmar quién es antes de pedirle la contraseña. */
export interface AccountSummary {
  userId: string;
  username: string;
  firstName: string | null;
}

/** Una cuenta eliminada (deleted_at) es intocable: no se reactiva, no cambia de rol, no se edita. */
export function assertNotDeleted(account: { deletedAt?: Date | null } | null | undefined): void {
  if (account?.deletedAt) {
    throw new AccountDeletedError();
  }
}

/** La persona de la cuenta (person_id es NOT NULL: si falta, la lectura no la trajo). */
export function requirePerson<P>(account: { person?: P | null }): P {
  if (!account.person) {
    throw new AccountWithoutPersonError();
  }
  return account.person;
}

/** Los roles de cliente: los únicos que gestiona el panel de clientes (los internos van por admin-user). */
export function isClientRole(roleName: string | null | undefined): boolean {
  return Boolean(roleName) && (CLIENT_ROLE_NAMES as readonly string[]).includes(roleName as string);
}

/** Activar una cuenta activa (o desactivar una inactiva) no es un cambio. */
export function assertStatusChange(account: Pick<AccountTarget, 'isActive'>, activate: boolean): void {
  if (account.isActive === activate) {
    throw new AccountStatusUnchangedError(activate);
  }
}

/**
 * El panel de clientes solo cambia el rol entre roles de cliente: ni toca una cuenta interna ni promueve un
 * cliente a interno (eso pasa por admin-user, con su doble aprobación). Primero la cuenta…
 */
export function assertClientAccount(account: Pick<AccountTarget, 'role'>): void {
  if (!isClientRole(account.role?.name)) {
    throw new NotAClientAccountError();
  }
}

/** …y después el rol nuevo, que debe ser de cliente y distinto del actual. */
export function assertClientRoleChange(account: Pick<AccountTarget, 'roleId'>, newRole: RoleRef): void {
  if (!isClientRole(newRole.name)) {
    throw new NotAClientRoleError();
  }
  if (account.roleId === newRole.roleId) {
    throw new SameRoleError();
  }
}

/** Qué se apaga al desactivar el MFA de una cuenta (el que tenga: TOTP, SMS o ambos). */
export interface MfaShutdown {
  preferredMfaMethod: 'none';
  totpEnabled?: false;
  /** Se borra el secreto TOTP junto con el factor. */
  clearTotpSecret?: true;
  smsMfaEnabled?: false;
}

export function mfaShutdown(account: Pick<AccountTarget, 'totpEnabled' | 'smsMfaEnabled'>): MfaShutdown {
  if (!account.totpEnabled && !account.smsMfaEnabled) {
    throw new MfaNotEnabledError();
  }
  return {
    preferredMfaMethod: 'none',
    ...(account.totpEnabled ? { totpEnabled: false as const, clearTotpSecret: true as const } : {}),
    ...(account.smsMfaEnabled ? { smsMfaEnabled: false as const } : {})
  };
}
