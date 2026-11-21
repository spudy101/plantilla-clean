import type userRepositoryModule from '../../repositories/user.repository';
type UserRepositoryPort = typeof userRepositoryModule;
type UserRepositoryFilters = NonNullable<Parameters<UserRepositoryPort['findAllPaginated']>[0]>;
// modules/admin/kyc/iam/services/admin-user/internal-user-query.service.ts
//
// Lecturas de usuarios internos: listados, detalle, catálogo de roles, sesiones y bitácora.
// Extraído de AdminUserService (SOLID: S).

import userRepository from '../../repositories/user.repository';
import roleRepository from '../../repositories/role.repository';
import userSessionRepository from '../../repositories/user-session.repository';
import auditModule from '../../../audit';
const { userChangeLogRepository, audit } = auditModule;
import approvalsModule from '../../../approvals';
const { DualApprovalService } = approvalsModule;
import constantsModule from '../../../../shared/constants';
const { INTERNAL_ROLE_NAMES, SUPERADMIN_ROLE_NAMES } = constantsModule;
import adminUserDtoModule from '../../responses/admin-user.response';
const {
  InternalUserDTO,
  InternalUserListDTO,
  UserSessionDTO,
  UserChangeLogDTO,
  RoleOptionDTO
} = adminUserDtoModule;
import internalUserGuardsModule from './internal-user-guards';
import { pageOf, pageRequest } from '../../../../shared/http/pagination';
import type { InternalUserDeletedListQuery, InternalUserListQuery, UserChangeLogsQuery } from '../../requests/iam.request';
const { InternalUserGuards } = internalUserGuardsModule;
const ENTITY = { entityType: 'InternalUser', entityTable: 'users' };

class InternalUserQueryService {
  userRepository: typeof userRepository;
  roleRepository: typeof roleRepository;
  userSessionRepository: typeof userSessionRepository;
  userChangeLogRepository: typeof userChangeLogRepository;
  DualApprovalService: typeof DualApprovalService;
  guards: InstanceType<typeof InternalUserGuards>;

  /** @param {object} [deps] Dependencias inyectables (SOLID: D). Las provee la fachada AdminUserService. */
  constructor(deps: InternalUserQueryService.Deps = {}) {
    this.userRepository = deps.userRepository ?? userRepository;
    this.roleRepository = deps.roleRepository ?? roleRepository;
    this.userSessionRepository = deps.userSessionRepository ?? userSessionRepository;
    this.userChangeLogRepository = deps.userChangeLogRepository ?? userChangeLogRepository;
    this.DualApprovalService = deps.DualApprovalService ?? DualApprovalService;
    this.guards = deps.guards ?? new InternalUserGuards(deps);
  }

  async list(query: InternalUserListQuery, adminUserId: string) {
    const page = pageRequest(query);
    // El listado nunca expone superadmins (se excluyen de los roles visibles).
    const internalRoleIds = await this.guards.listableInternalRoleIds();

    // Filtro por rol: si viene roleId validamos que sea interno (y no superadmin)
    // antes de usarlo; si no, listamos todos los roles internos visibles.
    const roleIds = query.roleId && internalRoleIds.includes(query.roleId) ? [query.roleId] : internalRoleIds;

    // Excluimos al propio solicitante: un admin no se ve a sí mismo en el listado.
    const filters: UserRepositoryFilters = { roleIds, excludeUserId: adminUserId, isActive: query.isActive ?? undefined };

    const { rows, count } = await this.userRepository.findAllPaginated(filters, page, query.search ?? null);

    await this.DualApprovalService.annotatePending('User', rows, 'userId');

    await audit.record('INTERNAL_USER_LIST_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count },
      ...ENTITY
    });

    return pageOf(rows.map(InternalUserListDTO), page, count, { search: query.search, roleId: query.roleId, isActive: query.isActive });
  }

  /**
   * Listado HISTÓRICO de usuarios internos ELIMINADOS (read-only). Solo cuentas con
   * deleted_at != null. El listado normal (list) las excluye; son intocables.
   */
  async listDeleted(query: InternalUserDeletedListQuery, adminUserId: string) {
    const page = pageRequest(query);
    const internalRoleIds = await this.guards.listableInternalRoleIds();
    const roleIds = query.roleId && internalRoleIds.includes(query.roleId) ? [query.roleId] : internalRoleIds;

    const filters: UserRepositoryFilters = { roleIds, onlyDeleted: true };
    const { rows, count } = await this.userRepository.findAllPaginated(filters, page, query.search ?? null);

    await audit.record('INTERNAL_USER_DELETED_LIST_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count },
      ...ENTITY
    });

    return pageOf(rows.map(InternalUserListDTO), page, count, { search: query.search, roleId: query.roleId });
  }

  /**
   * Catálogo de roles INTERNOS para poblar el filtro por rol del listado de usuarios internos.
   * Devuelve solo los roles listables (internos, sin superadmin) — los mismos que filtra `list`.
   */
  async listRoleOptions(adminUserId: string) {
    const roles = await this.roleRepository.findByNames(INTERNAL_ROLE_NAMES, { exclude: SUPERADMIN_ROLE_NAMES });
    await audit.record('INTERNAL_USER_ROLE_OPTIONS_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: roles.length },
      entityType: 'RbacRole',
      entityTable: 'roles'
    });
    return roles.map(RoleOptionDTO);
  }

  async getById(userId: string, adminUserId: string) {
    const user = await this.guards.getInternalUserOrFail(userId);
    await audit.record('INTERNAL_USER_VIEWED', {
      actorId: adminUserId,
      details: { targetUserId: userId },
      entityId: userId,
      ...ENTITY
    });
    return InternalUserDTO(user);
  }

  async listSessions(userId: string, adminUserId: string) {
    await this.guards.getInternalUserOrFail(userId);
    const sessions = await this.userSessionRepository.findActiveByUser(userId);
    await audit.record('INTERNAL_USER_SESSIONS_VIEWED', {
      actorId: adminUserId,
      details: { targetUserId: userId },
      entityId: userId,
      ...ENTITY
    });
    return sessions.map(UserSessionDTO);
  }

  async listChangeLogs(userId: string, query: UserChangeLogsQuery, adminUserId: string) {
    await this.guards.getInternalUserOrFail(userId);
    const page = pageRequest(query);
    const { rows, count } = await this.userChangeLogRepository.findByUserId(userId, page);

    await audit.record('INTERNAL_USER_CHANGE_LOGS_VIEWED', {
      actorId: adminUserId,
      details: { targetUserId: userId },
      entityId: userId,
      ...ENTITY
    });

    return pageOf(rows.map(UserChangeLogDTO), page, count);
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace InternalUserQueryService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userRepository?: typeof userRepository;
    roleRepository?: typeof roleRepository;
    userSessionRepository?: typeof userSessionRepository;
    userChangeLogRepository?: typeof userChangeLogRepository;
    DualApprovalService?: typeof DualApprovalService;
    guards?: InstanceType<typeof InternalUserGuards>;
  }
}

export default InternalUserQueryService;
