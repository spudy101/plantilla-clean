// Puerto: las cuentas de usuario (tabla users). Las lecturas devuelven la cuenta con lo que cada flujo necesita
// (persona y contacto, rol, perfil completo); el documento se busca por su hash: eso lo resuelve el adaptador.
import type { PageRequest } from '../../../../shared/application/pagination';
import type {
  AccountForDeletion,
  LoginUser,
  RoleRef,
  UserAccount,
  UserChanges,
  UserProfile,
  UserWithPhone
} from '../../domain/user';

export interface UserListFilters {
  isActive?: boolean;
  roleIds?: string[];
  nationalId?: string;
  userId?: string;
  /** Pisa a `userId`. */
  excludeUserId?: string;
  /** Solo las eliminadas (por defecto se excluyen). */
  onlyDeleted?: boolean;
  /** Eliminadas y vigentes. */
  includeDeleted?: boolean;
}

/** Alta de una cuenta. La contraseña ya llega hasheada. */
export interface NewUserAccount {
  username: string;
  authUsername?: string | null;
  passwordHash: string;
  personId: string;
  roleId: string;
  avatarId?: string | null;
  privacyPolicyVersion?: string | null;
  privacyPolicyAcceptedAt?: Date | null;
  privacyPolicyAcceptedIp?: string | null;
}

/** Lo que necesita una acción de administración sobre una cuenta: nombre, documento, email y rol. */
export interface AccountTarget extends UserAccount {
  person: {
    personId: string;
    firstName: string;
    nationalId: string | null;
    contact: { personContactId: string; email: string } | null;
  } | null;
  role: { roleId: string; name: string; description: string | null } | null;
}

/** La cuenta con su persona y su contacto (sin el resto del perfil). */
export interface UserWithContact extends UserAccount {
  person: {
    personId: string;
    firstName: string;
    lastName: string;
    contact: { email: string; phonePrimary: string | null; phonePrimaryPrefixId: string | null } | null;
  } | null;
}

export interface UserRepository {
  findById(userId: string): Promise<UserAccount | null>;
  /** La cuenta de una persona (person_id es único). */
  findByPersonId(personId: string): Promise<UserAccount | null>;
  findWithRole(userId: string): Promise<(UserAccount & { role: RoleRef | null }) | null>;
  /** Persona + contacto + rol (login, registro, tokens). */
  findLoginUser(userId: string): Promise<LoginUser | null>;
  findLoginUserByNationalId(nationalId: string): Promise<LoginUser | null>;
  findLoginUserByUsername(username: string): Promise<LoginUser | null>;
  /** Perfil completo. */
  findProfile(userId: string): Promise<UserProfile | null>;
  findWithContact(userId: string): Promise<UserWithContact | null>;
  findWithPrimaryPhone(userId: string): Promise<UserWithPhone | null>;
  findAdminTarget(userId: string): Promise<AccountTarget | null>;
  findForAccountDeletion(userId: string): Promise<AccountForDeletion | null>;
  findMfaFlags(userId: string): Promise<{ totpEnabled: boolean | null; smsMfaEnabled: boolean } | null>;
  /** Ids de las cuentas activas con un rol de `roleNames`. */
  findActiveIdsByRoleNames(roleNames: readonly string[]): Promise<string[]>;
  /** Una página de cuentas activas con un rol de `roleNames`, ordenadas por id, a partir de `afterUserId`. */
  findActivePageByRoleNames(roleNames: readonly string[], afterUserId: string | null, limit: number): Promise<UserWithContact[]>;
  /** Listado paginado con el perfil; `search` busca en username y nombres. */
  list(filters: UserListFilters, page: PageRequest, search: string | null): Promise<{ rows: UserProfile[]; count: number }>;

  create(account: NewUserAccount): Promise<UserAccount>;
  /** null si la cuenta no existe. */
  update(userId: string, changes: UserChanges & { passwordHash?: string; avatarId?: string }): Promise<UserAccount | null>;
}
