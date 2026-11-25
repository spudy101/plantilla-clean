// modules/admin/kyc/iam/services/admin-user.service.ts
//
// Gestión de USUARIOS INTERNOS (empleados de Base Project) — RF-ADM-01.
// Separado de la gestión de clientes (admin-person, dominio KYC).
//
// ============================================================
// ADMIN USER SERVICE — fachada
// ============================================================
// SOLID (S): este service tenía ~670 líneas (listados, alta/edición, rol, estado, eliminación,
// sesiones y bitácora). Ahora cada responsabilidad vive en su propio service (carpeta admin-user/):
//   - InternalUserQueryService     → listados, detalle, catálogo de roles, sesiones, bitácora
//   - InternalUserProfileService   → alta y edición de datos básicos
//   - InternalUserAccessService    → cambio de rol (doble aprobación), estado, cierre de sesiones
//   - InternalUserDeletionService  → eliminación (re-autenticación + doble aprobación + ofuscación)
//   - InternalUserGuards           → reglas compartidas (interno, superadmin, eliminado, sesiones)
// La API pública no cambia: controllers y el bootstrap de doble aprobación siguen igual.
// ============================================================

import type { AdminAuditContext } from '../../../shared/application/audit-context';
import userRepository from '../repositories/user.repository';
import roleRepository from '../repositories/role.repository';
import personModule from '../../person';
const { personRepository, ProfileHelper } = personModule;
import catalogsModule from '../../catalogs';
const { documentTypeRepository } = catalogsModule;
import userSessionRepository from '../repositories/user-session.repository';
import auditModule from '../../audit';
const { userChangeLogRepository } = auditModule;
import unitOfWork from '../../../shared/infrastructure/database/unit-of-work';
import notificationModule from '../../notification';
const { notifier } = notificationModule;
import approvalsModule from '../../approvals';
const { dualApproval } = approvalsModule;
import internalUserGuardsModule from './admin-user/internal-user-guards';
const { InternalUserGuards } = internalUserGuardsModule;
import InternalUserQueryService from './admin-user/internal-user-query.service';
import InternalUserProfileService from './admin-user/internal-user-profile.service';
import InternalUserAccessService from './admin-user/internal-user-access.service';
import InternalUserDeletionService from './admin-user/internal-user-deletion.service';
import type { InternalUserDeletedListQuery, InternalUserListQuery, UserChangeLogsQuery } from '../requests/iam.request';

/** Dependencias que comparten los sub-servicios (cada uno declara las suyas; aquí se unen). */
type SharedDeps = NonNullable<ConstructorParameters<typeof InternalUserQueryService>[0]> &
  NonNullable<ConstructorParameters<typeof InternalUserProfileService>[0]> &
  NonNullable<ConstructorParameters<typeof InternalUserAccessService>[0]> &
  NonNullable<ConstructorParameters<typeof InternalUserDeletionService>[0]> &
  NonNullable<ConstructorParameters<typeof InternalUserGuards>[0]>;

class AdminUserService {
  queries: InstanceType<typeof InternalUserQueryService>;
  profile: InstanceType<typeof InternalUserProfileService>;
  access: InstanceType<typeof InternalUserAccessService>;
  deletion: InstanceType<typeof InternalUserDeletionService>;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new AdminUserService({ unitOfWork: fake })
   * @param {object} [deps]
   */
  constructor(deps: AdminUserService.Deps = {}) {
    // Sub-servicios por responsabilidad (SOLID: S). Reciben las mismas dependencias.
    const shared: SharedDeps = {
      unitOfWork: deps.unitOfWork ?? unitOfWork,
      profileHelper: deps.profileHelper ?? ProfileHelper,
      userRepository: deps.userRepository ?? userRepository,
      roleRepository: deps.roleRepository ?? roleRepository,
      personRepository: deps.personRepository ?? personRepository,
      documentTypeRepository: deps.documentTypeRepository ?? documentTypeRepository,
      userSessionRepository: deps.userSessionRepository ?? userSessionRepository,
      userChangeLogRepository: deps.userChangeLogRepository ?? userChangeLogRepository,
      notifier: deps.notifier ?? notifier,
      dualApproval: deps.dualApproval ?? dualApproval
    };
    shared.guards = deps.guards ?? new InternalUserGuards(shared);

    this.queries = deps.queries ?? new InternalUserQueryService(shared);
    this.profile = deps.profile ?? new InternalUserProfileService(shared);
    this.access = deps.access ?? new InternalUserAccessService(shared);
    this.deletion = deps.deletion ?? new InternalUserDeletionService(shared);
  }

  // ── LECTURAS → InternalUserQueryService ──
  list(query: InternalUserListQuery, adminUserId: string) {
    return this.queries.list(query, adminUserId);
  }

  listDeleted(query: InternalUserDeletedListQuery, adminUserId: string) {
    return this.queries.listDeleted(query, adminUserId);
  }

  listRoleOptions(adminUserId: string) {
    return this.queries.listRoleOptions(adminUserId);
  }

  getById(userId: string, adminUserId: string) {
    return this.queries.getById(userId, adminUserId);
  }

  listSessions(userId: string, adminUserId: string) {
    return this.queries.listSessions(userId, adminUserId);
  }

  listChangeLogs(userId: string, query: UserChangeLogsQuery, adminUserId: string) {
    return this.queries.listChangeLogs(userId, query, adminUserId);
  }

  // ── ALTA / EDICIÓN → InternalUserProfileService ──
  create(data: Parameters<AdminUserService['profile']['create']>[0], auditCtx: AdminAuditContext) {
    return this.profile.create(data, auditCtx);
  }

  update(userId: string, data: Parameters<AdminUserService['profile']['update']>[1], auditCtx: AdminAuditContext) {
    return this.profile.update(userId, data, auditCtx);
  }

  // ── ACCESO → InternalUserAccessService ──
  changeRole(userId: string, newRoleId: string, auditCtx: AdminAuditContext) {
    return this.access.changeRole(userId, newRoleId, auditCtx);
  }

  /** Reanudación del handler de doble aprobación (RBAC_ROLE_CHANGE). */
  executeChangeRole(
    userId: string,
    newRoleId: string,
    auditCtx: AdminAuditContext,
    prefetched: Parameters<AdminUserService['access']['executeChangeRole']>[3] = {}
  ) {
    return this.access.executeChangeRole(userId, newRoleId, auditCtx, prefetched);
  }

  setStatus(userId: string, isActive: boolean, auditCtx: AdminAuditContext) {
    return this.access.setStatus(userId, isActive, auditCtx);
  }

  closeSessions(userId: string, auditCtx: AdminAuditContext) {
    return this.access.closeSessions(userId, auditCtx);
  }

  // ── ELIMINACIÓN → InternalUserDeletionService ──
  deleteUser(userId: string, currentPassword: string, auditCtx: AdminAuditContext) {
    return this.deletion.deleteUser(userId, currentPassword, auditCtx);
  }

  /** Reanudación del handler de doble aprobación (INTERNAL_USER_DELETE). */
  executeDeleteUser(userId: string, auditCtx: AdminAuditContext) {
    return this.deletion.executeDeleteUser(userId, auditCtx);
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace AdminUserService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps extends SharedDeps {
    queries?: InstanceType<typeof InternalUserQueryService>;
    profile?: InstanceType<typeof InternalUserProfileService>;
    access?: InstanceType<typeof InternalUserAccessService>;
    deletion?: InstanceType<typeof InternalUserDeletionService>;
  }
}

export default Object.assign(new AdminUserService(), { AdminUserService });
