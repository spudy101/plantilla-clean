// Lo que iam ofrece a los demás módulos (por los adaptadores de src/main/): las cuentas y los roles (person, catalogs,
// approvals, notification) y las sesiones y dispositivos (la traza de sesiones de audit). Ninguno de esos módulos
// conoce los repositorios de iam: piden lo suyo acá.
import type { PageRequest } from '../../../../shared/application/pagination';
import rbacModule from '../../../../shared/domain/constants/rbac';
import type { SessionFilters } from '../../domain/session';
import type { UserChanges } from '../../domain/user';
import type { UserListFilters } from '../ports/user-repository.port';
import type { IamDeps } from './iam-deps';

const { CLIENT_ROLE_NAMES } = rbacModule;

/** Las cuentas de usuario, para el panel de clientes y el perfil (person) y los avisos (notification, approvals). */
export class AccountDirectory {
  constructor(private readonly deps: Pick<IamDeps, 'users' | 'passwords'>) {}

  findProfile(userId: string) {
    return this.deps.users.findProfile(userId);
  }

  list(filters: UserListFilters, page: PageRequest, search: string | null) {
    return this.deps.users.list(filters, page, search);
  }

  findTarget(userId: string) {
    return this.deps.users.findAdminTarget(userId);
  }

  async findSummary(userId: string) {
    const user = await this.deps.users.findWithContact(userId);
    return user ? { userId: user.userId, username: user.username, firstName: user.person?.firstName ?? null } : null;
  }

  async passwordMatches(userId: string, plainPassword: string) {
    const user = await this.deps.users.findById(userId);
    return this.deps.passwords.matches(plainPassword, user?.passwordHash ?? null);
  }

  async findUserIdByUsername(username: string) {
    return (await this.deps.users.findLoginUserByUsername(username))?.userId ?? null;
  }

  async create(account: { username: string; authUsername: string; personId: string; roleId: string; password: string }) {
    const { password, ...rest } = account;
    const { userId } = await this.deps.users.create({ ...rest, passwordHash: await this.deps.passwords.hash(password) });
    return { userId };
  }

  async update(userId: string, changes: UserChanges & { avatarId?: string }) {
    await this.deps.users.update(userId, changes);
  }

  async setPassword(userId: string, plainPassword: string) {
    await this.deps.users.update(userId, { passwordHash: await this.deps.passwords.hash(plainPassword) });
  }

  /** Contacto de un usuario para avisarle (notification). */
  async findRecipient(userId: string) {
    const user = await this.deps.users.findWithContact(userId);
    if (!user) {
      return null;
    }
    const contact = user.person?.contact ?? null;
    return {
      userId: user.userId,
      isActive: Boolean(user.isActive),
      email: contact?.email ?? null,
      phone: contact?.phonePrimary ? { number: contact.phonePrimary, prefixId: contact.phonePrimaryPrefixId ?? null } : null
    };
  }

  /** Una página de clientes finales activos (nunca internos), para el envío masivo. */
  async activeClientsAfter(afterUserId: string | null, limit: number) {
    const users = await this.deps.users.findActivePageByRoleNames(CLIENT_ROLE_NAMES, afterUserId, limit);
    return users.map(user => ({ userId: user.userId, email: user.person?.contact?.email ?? null }));
  }

  /** Los usuarios activos con alguno de esos roles (los aprobadores de approvals). */
  activeUserIdsWithRoles(roleNames: readonly string[]) {
    return this.deps.users.findActiveIdsByRoleNames(roleNames);
  }
}

/** Los roles (person los valida; catalogs los lista). */
export class RoleDirectory {
  constructor(private readonly deps: Pick<IamDeps, 'roles'>) {}

  list(filters: { isActive?: boolean } & Record<string, unknown>, page: PageRequest, search: string | null) {
    return this.deps.roles.list(filters, page, search);
  }

  findById(roleId: string) {
    return this.deps.roles.findById(roleId);
  }

  findByName(name: string) {
    return this.deps.roles.findByName(name);
  }

  findByNames(names: readonly string[]) {
    return this.deps.roles.findByNames(names);
  }
}

/** Las sesiones y los dispositivos, para la traza de sesiones y el feed de actividad de audit. */
export class SessionDirectory {
  constructor(private readonly deps: Pick<IamDeps, 'sessions' | 'devices'>) {}

  list(filters: SessionFilters, page: PageRequest) {
    return this.deps.sessions.findPaginatedWithDeviceAndUser(filters, page);
  }

  findById(sessionId: string) {
    return this.deps.sessions.findByIdWithDeviceAndUser(sessionId);
  }

  async exists(sessionId: string) {
    return (await this.deps.sessions.findById(sessionId)) !== null;
  }

  devicesOfOwnSessions(sessionIds: string[], userId: string) {
    return this.deps.sessions.findDevicesOfOwnSessions(sessionIds, userId);
  }

  devicesByIds(ids: readonly string[]) {
    return this.deps.devices.findByIds(ids);
  }
}
