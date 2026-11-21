import type { Role } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { UserProfileRow } from '../../repositories/user.repository';
// modules/admin/kyc/iam/services/admin-user/internal-user-access.service.ts
//
// Control de acceso de usuarios internos: cambio de rol (doble aprobación), activar/desactivar
// y cierre de sesiones. Extraído de AdminUserService (SOLID: S).

import type { AdminAuditContext } from '../../../../shared/application/audit-context';
import userRepository from '../../repositories/user.repository';
import personModule from '../../../person';
const { KycSharedUtil } = personModule;
import notificationModule from '../../../notification';
const { notifier } = notificationModule;
import approvalsModule from '../../../approvals';
const { DualApprovalService } = approvalsModule;
import AppError from '../../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../../shared/infrastructure/config';
const { notifications } = constantsModule;
import adminUserDtoModule from '../../responses/admin-user.response';
const { InternalUserDTO } = adminUserDtoModule;
import internalUserGuardsModule from './internal-user-guards';
const { InternalUserGuards, displayName } = internalUserGuardsModule;
import auditModule from '../../../audit';
import type { InternalUserSessionsClosed } from '../../responses/admin-user.response';
const { audit } = auditModule;

const ENTITY = { entityType: 'InternalUser', entityTable: 'users' };

class InternalUserAccessService {
  userRepository: typeof userRepository;
  kycSharedUtil: typeof KycSharedUtil;
  notifier: typeof notifier;
  DualApprovalService: typeof DualApprovalService;
  guards: InstanceType<typeof InternalUserGuards>;

  /** @param {object} [deps] Dependencias inyectables (SOLID: D). Las provee la fachada AdminUserService. */
  constructor(deps: InternalUserAccessService.Deps = {}) {
    this.userRepository = deps.userRepository ?? userRepository;
    this.kycSharedUtil = deps.kycSharedUtil ?? KycSharedUtil;
    this.notifier = deps.notifier ?? notifier;
    this.DualApprovalService = deps.DualApprovalService ?? DualApprovalService;
    this.guards = deps.guards ?? new InternalUserGuards(deps);
  }

  // ============================================================
  // CAMBIO DE ROL (auditado — criterio #4, doble aprobación)
  // ============================================================

  async changeRole(userId: string, newRoleId: string, auditCtx: AdminAuditContext) {
    const user = await this.guards.getInternalUserOrFail(userId);
    this.guards.assertNotDeleted(user);

    // Protección: el rol de un superadministrador no se puede modificar.
    if (this.guards.isSuperAdminRole(user.role?.name)) {
      throw AppError.forbidden('No se puede cambiar el rol de un super administrador');
    }

    const newRole = await this.guards.getInternalRoleOrFail(newRoleId);
    if (user.roleId === newRoleId) {
      throw AppError.badRequest('El usuario ya tiene este rol');
    }

    // Doble aprobación (maker-checker). Las validaciones de arriba corren ANTES del gate, así una
    // operación inviable nunca crea un approval_request. Pendiente → 202; inline en otro caso.
    // El handler IoC reanuda con executeChangeRole (no re-gatea).
    const gate = await this.DualApprovalService.gate('RBAC_ROLE_CHANGE', {
      entityType: 'User',
      entityId: userId,
      payload: { userId, roleId: newRoleId },
      ctx: auditCtx
    });
    if (gate.pending) {
      return { pending: true, approvalRequest: gate.request };
    }

    return this.executeChangeRole(userId, newRoleId, auditCtx, { user, newRole });
  }

  /**
   * Ejecuta el cambio de rol REAL (update + bitácora + invalidación de sesiones + notificación).
   * Punto de entrada del handler de doble aprobación (reanudación) y de la ejecución directa.
   * @param {Object} [prefetched] — { user, newRole } ya cargados (camino inline); el handler IoC
   *        los omite y se recargan por id (idempotente).
   */
  async executeChangeRole(
    userId: string,
    newRoleId: string,
    auditCtx: AdminAuditContext,
    prefetched: { user?: UserProfileRow; newRole?: Role } = {}
  ) {
    const user = prefetched.user ?? (await this.guards.getInternalUserOrFail(userId));
    const newRole = prefetched.newRole ?? (await this.guards.getInternalRoleOrFail(newRoleId));

    const oldRoleName = user.role?.name || null;

    await this.userRepository.update(userId, { roleId: newRoleId });

    await this.kycSharedUtil.logChange({
      userId,
      changedByUserId: auditCtx.adminUserId,
      changedByRole: 'admin',
      changeType: 'role',
      previousValue: oldRoleName,
      newValue: newRole.name,
      changeReason: 'Rol actualizado por administrador',
      ipAddress: auditCtx.ipAddress,
      userAgent: auditCtx.userAgent
    });

    // El cambio de rol invalida las sesiones activas para que el nuevo rol surta
    // efecto de inmediato (los JWT vigentes llevan el roleName anterior).
    await this.guards.invalidateSessions(userId, 'role_changed');

    await audit.record('INTERNAL_USER_ROLE_CHANGED', {
      actorId: auditCtx.adminUserId,
      details: { before: { role: oldRoleName }, after: { role: newRole.name } },
      entityId: userId,
      ...ENTITY
    });

    const nombre = displayName(user);
    setImmediate(() => {
      const { logoUrl } = notifications.ses;
      this.notifier.notify({
        type: 'IAM_INTERNAL_USER_ROLE_CHANGED',
        userId,
        relatedEntity: { type: 'User', id: userId },
        metadata: { nombre, rolAnterior: oldRoleName || '—', nuevoRol: newRole.name, logoUrl }
      }).catch(err => logger.warn('Error enviando IAM_INTERNAL_USER_ROLE_CHANGED', { error: err.message }));
      this.notifier.notify({
        type: 'IAM_ADMIN_ROLE_CHANGED',
        userId: auditCtx.adminUserId,
        relatedEntity: { type: 'User', id: userId },
        metadata: { nombreUsuario: nombre, rolAnterior: oldRoleName || '—', nuevoRol: newRole.name, logoUrl }
      }).catch(err => logger.warn('Error enviando IAM_ADMIN_ROLE_CHANGED', { error: err.message }));
    });

    const fresh = await this.userRepository.findByUserId(userId, 'basic');
    return InternalUserDTO(fresh);
  }

  // ============================================================
  // ESTADO (activar / desactivar — auditado)
  // ============================================================

  async setStatus(userId: string, isActive: boolean, auditCtx: AdminAuditContext) {
    const user = await this.guards.getInternalUserOrFail(userId);
    this.guards.assertNotDeleted(user);

    // Protección: un superadministrador no se puede desactivar.
    if (!isActive && this.guards.isSuperAdminRole(user.role?.name)) {
      throw AppError.forbidden('No se puede desactivar a un super administrador');
    }

    if (user.isActive === isActive) {
      throw AppError.badRequest(`El usuario ya está ${isActive ? 'activo' : 'inactivo'}`);
    }

    await this.userRepository.setActiveStatus(userId, isActive);

    await this.kycSharedUtil.logChange({
      userId,
      changedByUserId: auditCtx.adminUserId,
      changedByRole: 'admin',
      changeType: 'account_status',
      previousValue: user.isActive ? 'active' : 'inactive',
      newValue: isActive ? 'active' : 'inactive',
      changeReason: 'Estado de cuenta actualizado por administrador',
      ipAddress: auditCtx.ipAddress,
      userAgent: auditCtx.userAgent
    });

    // Al desactivar, cerramos sus sesiones para forzar el cierre inmediato.
    if (!isActive) {
      await this.guards.invalidateSessions(userId, 'account_deactivated');
    }

    await audit.record(isActive ? 'INTERNAL_USER_ACTIVATED' : 'INTERNAL_USER_DEACTIVATED', {
      actorId: auditCtx.adminUserId,
      details: { before: { isActive: !isActive }, after: { isActive } },
      entityId: userId,
      ...ENTITY
    });

    const nombre = displayName(user);
    const accion = isActive ? 'activado' : 'desactivado';
    setImmediate(() => {
      const { logoUrl } = notifications.ses;
      this.notifier.notify({
        type: isActive ? 'IAM_INTERNAL_USER_ACTIVATED' : 'IAM_INTERNAL_USER_DEACTIVATED',
        userId,
        relatedEntity: { type: 'User', id: userId },
        metadata: { nombre, logoUrl }
      }).catch(err =>
        logger.warn(`Error enviando IAM_INTERNAL_USER_${isActive ? 'ACTIVATED' : 'DEACTIVATED'}`, { error: err.message })
      );
      this.notifier.notify({
        type: 'IAM_ADMIN_STATUS_CHANGED',
        userId: auditCtx.adminUserId,
        relatedEntity: { type: 'User', id: userId },
        metadata: { nombreUsuario: nombre, accion, logoUrl }
      }).catch(err => logger.warn('Error enviando IAM_ADMIN_STATUS_CHANGED', { error: err.message }));
    });

    const fresh = await this.userRepository.findByUserId(userId, 'basic');
    return InternalUserDTO(fresh);
  }

  // ============================================================
  // CIERRE DE SESIONES
  // ============================================================

  async closeSessions(userId: string, auditCtx: AdminAuditContext) {
    const user = await this.guards.getInternalUserOrFail(userId);
    this.guards.assertNotDeleted(user);
    await this.guards.invalidateSessions(userId, 'closed_by_admin');
    await audit.record('INTERNAL_USER_SESSIONS_CLOSED', {
      actorId: auditCtx.adminUserId,
      details: { targetUserId: userId },
      entityId: userId,
      ...ENTITY
    });

    const nombre = displayName(user);
    setImmediate(() => {
      this.notifier.notify({
        type: 'IAM_INTERNAL_USER_SESSIONS_CLOSED',
        userId,
        relatedEntity: { type: 'User', id: userId },
        metadata: { nombre }
      }).catch(err => logger.warn('Error enviando IAM_INTERNAL_USER_SESSIONS_CLOSED', { error: err.message }));
    });
    return { userId, closed: true } satisfies InternalUserSessionsClosed;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace InternalUserAccessService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userRepository?: typeof userRepository;
    kycSharedUtil?: typeof KycSharedUtil;
    notifier?: typeof notifier;
    DualApprovalService?: typeof DualApprovalService;
    guards?: InstanceType<typeof InternalUserGuards>;
  }
}

export default InternalUserAccessService;
