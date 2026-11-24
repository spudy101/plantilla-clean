// Puerto: las cuentas de usuario, que son de iam. Person las lee con su perfil y les cambia lo que el panel de
// clientes y el perfil propio permiten (username, avatar, contraseña, estado, rol, MFA, baja).
//
// Lo implementa src/main/adapters/person-sources.adapter.ts con iam.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { AccountSummary, AccountTarget, ClientAccount, MfaShutdown, RoleRef } from '../../domain/client-account';

export interface AccountListFilters {
  isActive?: boolean;
  roleIds?: string[];
  /** Búsqueda exacta por documento. */
  nationalId?: string;
  userId?: string;
  /** Solo las cuentas eliminadas (por defecto se excluyen). */
  onlyDeleted?: boolean;
}

export interface NewAccount {
  username: string;
  authUsername: string;
  personId: string;
  roleId: string;
  /** En claro: la hashea quien guarda. */
  password: string;
}

export interface ClientAccounts {
  /** La cuenta con su perfil completo. */
  findProfile(userId: string): Promise<ClientAccount | null>;
  /** Una página de cuentas con su perfil; `search` busca en username y nombres. */
  list(filters: AccountListFilters, page: PageRequest, search: string | null): Promise<{ rows: ClientAccount[]; count: number }>;
  /** Lo que necesita una acción del panel sobre la cuenta. */
  findTarget(userId: string): Promise<AccountTarget | null>;
  findSummary(userId: string): Promise<AccountSummary | null>;
  passwordMatches(userId: string, plainPassword: string): Promise<boolean>;
  /** El id de la cuenta que usa ese username, si alguna. */
  findUserIdByUsername(username: string): Promise<string | null>;

  create(account: NewAccount): Promise<{ userId: string }>;
  updateProfile(userId: string, changes: { username?: string; avatarId?: string }): Promise<void>;
  setPassword(userId: string, plainPassword: string): Promise<void>;
  setActive(userId: string, isActive: boolean): Promise<void>;
  setRole(userId: string, roleId: string): Promise<void>;
  shutDownMfa(userId: string, shutdown: MfaShutdown): Promise<void>;
  /** Baja irreversible: username ofuscado, cuenta inactiva y deleted_at sellado. */
  markDeleted(userId: string, anonymizedUsername: string, at: Date): Promise<void>;
}

/** Los roles (de iam). */
export interface RoleDirectory {
  findById(roleId: string): Promise<RoleRef | null>;
  findByName(name: string): Promise<RoleRef | null>;
  findByNames(names: readonly string[]): Promise<RoleRef[]>;
}
