// La cuenta de usuario: credenciales, rol, MFA, política aceptada y la persona detrás (de person, que iam lee y
// crea por puertos). Son formas de lectura: el adaptador de persistencia devuelve filas que encajan en ellas.
import rbacModule from '../../../shared/domain/constants/rbac';
import { UserDeletedError } from './errors';

const { INTERNAL_ROLE_NAMES, SUPERADMIN_ROLE_NAMES, CLIENT_ROLE_NAMES } = rbacModule;

export type MfaMethod = 'none' | 'totp' | 'sms';

export interface RoleRef {
  roleId: string;
  name: string;
  description: string | null;
  isActive?: boolean | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** La fila de la cuenta, con sus columnas de seguridad (hash, secreto TOTP, flags de MFA). */
export interface UserAccount {
  userId: string;
  username: string;
  passwordHash: string | null;
  authUsername: string | null;
  personId: string;
  roleId: string;
  avatarId: string | null;
  totpEnabled: boolean | null;
  totpSecret: string | null;
  smsMfaEnabled: boolean;
  preferredMfaMethod: string;
  privacyPolicyVersion: string | null;
  privacyPolicyAcceptedAt: Date | null;
  privacyPolicyAcceptedIp: string | null;
  isActive: boolean | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactRef {
  personContactId: string;
  personId: string;
  email: string;
  emailVerifiedAt: Date | null;
  phonePrimary: string | null;
  phonePrimaryPrefixId: string | null;
  phonePrimaryVerifiedAt: Date | null;
  phoneSecondary: string | null;
  phoneSecondaryPrefixId: string | null;
  phoneSecondaryVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** El contacto con el prefijo de cada teléfono (lo que se muestra en un perfil). */
export interface ContactWithPrefixes extends ContactRef {
  phonePrimaryPrefix: { prefix: string | null } | null;
  phoneSecondaryPrefix: { prefix: string | null } | null;
}

/** La persona de la cuenta con lo que muestran el login y los listados (nombres, documento, contacto). */
export interface PersonRef {
  personId: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  secondLastName: string | null;
  nationalId: string | null;
  birthDate: Date | null;
  genderId: string | null;
  countryId: string | null;
  documentTypeId: string | null;
  createdAt: Date;
  updatedAt: Date;
  contact: ContactRef | null;
}

/** La persona con todo lo que muestra un perfil: contacto con los prefijos, género, país, tipo de documento y ubicación. */
export interface PersonProfileRef extends PersonRef {
  contact: ContactWithPrefixes | null;
  gender: { genderId: string; name: string } | null;
  country: { countryId: string; name: string; code: string; iconUrl: string | null } | null;
  documentType: { documentTypeId: string; code: string; name: string } | null;
  location: {
    personLocationId: string;
    personId: string;
    address: string;
    postalCode: string | null;
    type: string | null;
    countryId: string | null;
    departmentId: string;
    cityId: string;
    country: { countryId: string; name: string; code: string; iconUrl: string | null } | null;
    department: { departmentId: string; name: string; daneCode: string | null };
    city: { cityId: string; name: string; daneCode: string | null };
  } | null;
}

/** La cuenta con su persona (+ contacto) y su rol: lo que necesitan el login, el registro y los tokens. */
export interface LoginUser extends UserAccount {
  role: RoleRef | null;
  person: PersonRef | null;
}

/** La cuenta con el perfil completo (persona con contacto, género, país, documento, ubicación; rol; avatar). */
export interface UserProfile extends UserAccount {
  role: RoleRef | null;
  person: PersonProfileRef | null;
  avatar: { avatarId: string; name: string; imageUrl: string | null } | null;
}

/** Lo mínimo para ofuscar una cuenta al eliminarla. */
export interface AccountForDeletion {
  userId: string;
  username: string;
  person: {
    personId: string;
    nationalId: string | null;
    firstName: string;
    contact: { personContactId: string; email: string } | null;
  } | null;
}

/** La cuenta con el teléfono principal de su contacto (MFA por SMS). */
export interface UserWithPhone extends UserAccount {
  person: { personId: string; contact: { phonePrimary: string | null; phonePrimaryPrefixId: string | null } | null } | null;
}

/** Cambios que iam aplica sobre la fila de la cuenta. */
export interface UserChanges {
  roleId?: string;
  username?: string;
  isActive?: boolean;
  deletedAt?: Date | null;
  totpEnabled?: boolean;
  totpSecret?: string | null;
  smsMfaEnabled?: boolean;
  preferredMfaMethod?: string;
  privacyPolicyVersion?: string;
  privacyPolicyAcceptedAt?: Date;
  privacyPolicyAcceptedIp?: string | null;
}

// ── Reglas ─────────────────────────────────────────────────────
export function isInternalRole(roleName: string | null | undefined): boolean {
  return !!roleName && (INTERNAL_ROLE_NAMES as readonly string[]).includes(roleName);
}

export function isSuperAdminRole(roleName: string | null | undefined): boolean {
  return !!roleName && (SUPERADMIN_ROLE_NAMES as readonly string[]).includes(roleName);
}

export function isClientRole(roleName: string | null | undefined): boolean {
  return !!roleName && (CLIENT_ROLE_NAMES as readonly string[]).includes(roleName);
}

/** Las cuentas eliminadas son intocables: no se editan, no cambian de rol/estado, no se re-eliminan. */
export function assertNotDeleted(user: { deletedAt?: Date | null } | null | undefined): void {
  if (user?.deletedAt) {
    throw new UserDeletedError();
  }
}

/** El handle con el que se registran los intentos (auth_username es nullable; la columna del intento no). */
export function loginHandle(user: Pick<UserAccount, 'authUsername' | 'username'>): string {
  return user.authUsername ?? user.username;
}

/** Nombre completo para notificaciones ("Usuario" si no hay datos). */
export function displayName(user: { person?: { firstName?: string | null; lastName?: string | null } | null }): string {
  return [user.person?.firstName, user.person?.lastName].filter(Boolean).join(' ') || 'Usuario';
}

/** ¿Tiene algún segundo factor activo? */
export function hasActiveMfa(flags: { totpEnabled?: boolean | null; smsMfaEnabled?: boolean | null } | null): boolean {
  return !!flags && (flags.totpEnabled === true || flags.smsMfaEnabled === true);
}
