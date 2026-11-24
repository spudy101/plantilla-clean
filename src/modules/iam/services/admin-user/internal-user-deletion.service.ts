// modules/admin/kyc/iam/services/admin-user/internal-user-deletion.service.ts
//
// Eliminación de usuarios internos: re-autenticación del admin, doble aprobación y ofuscación
// irreversible. Extraído de AdminUserService (SOLID: S).

import type { AdminAuditContext } from '../../../../shared/application/audit-context';
import userRepository from '../../repositories/user.repository';
import personModule from '../../../person';
const { ProfileHelper } = personModule;
import notificationModule from '../../../notification';
const { notifier } = notificationModule;
import approvalsModule from '../../../approvals';
const { DualApprovalService } = approvalsModule;
import unitOfWork from '../../../../shared/infrastructure/database/unit-of-work';
import AppError from '../../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../../shared/infrastructure/config';
const { notifications } = constantsModule;
import internalUserGuardsModule from './internal-user-guards';
const { InternalUserGuards } = internalUserGuardsModule;
import auditModule from '../../../audit';
import type { InternalUserDeleted } from '../../responses/admin-user.response';
const { audit } = auditModule;

class InternalUserDeletionService {
  unitOfWork: typeof unitOfWork;
  userRepository: typeof userRepository;
  profileHelper: typeof ProfileHelper;
  notifier: typeof notifier;
  DualApprovalService: typeof DualApprovalService;
  guards: InstanceType<typeof InternalUserGuards>;

  /** @param {object} [deps] Dependencias inyectables (SOLID: D). Las provee la fachada AdminUserService. */
  constructor(deps: InternalUserDeletionService.Deps = {}) {
    this.unitOfWork = deps.unitOfWork ?? unitOfWork;
    this.userRepository = deps.userRepository ?? userRepository;
    this.profileHelper = deps.profileHelper ?? ProfileHelper;
    this.notifier = deps.notifier ?? notifier;
    this.DualApprovalService = deps.DualApprovalService ?? DualApprovalService;
    this.guards = deps.guards ?? new InternalUserGuards(deps);
  }

  async deleteUser(userId: string, currentPassword: string, auditCtx: AdminAuditContext) {
    // Re-autenticación del admin (maker) ANTES de gatear la doble aprobación.
    const adminUser = await this.userRepository.findByUserId(auditCtx.adminUserId, 'minimal');
    if (!adminUser) {
      throw AppError.notFound('Administrador no encontrado');
    }
    if (!(await this.userRepository.verifyPassword(currentPassword, adminUser.passwordHash))) {
      throw AppError.badRequest('Contraseña actual incorrecta');
    }

    // Debe ser un interno existente, no superadmin y no estar ya eliminado.
    const user = await this.guards.getInternalUserOrFail(userId);
    this.guards.assertNotDeleted(user);
    if (this.guards.isSuperAdminRole(user.role?.name)) {
      throw AppError.forbidden('No se puede eliminar a un super administrador');
    }

    // Doble aprobación (maker-checker). Pendiente → 202 y la eliminación corre luego desde el
    // handler IoC (executeDeleteUser). Flag off / super_admin → se ejecuta inline.
    const gate = await this.DualApprovalService.gate('INTERNAL_USER_DELETE', {
      entityType: 'User',
      entityId: userId,
      payload: { userId },
      ctx: auditCtx
    });
    if (gate.pending) {
      return { pending: true, approvalRequest: gate.request };
    }

    await this.executeDeleteUser(userId, auditCtx);
    return { userId, deleted: true } satisfies InternalUserDeleted;
  }

  /**
   * Ejecuta la eliminación REAL del usuario interno (ofuscación en BD + cierre de
   * sesiones). Punto de entrada del handler de doble aprobación y de la ejecución directa.
   */
  async executeDeleteUser(userId: string, auditCtx: AdminAuditContext) {
    const user = await this.unitOfWork.run(async () => {
      const user = await this.userRepository.findForAccountDeletion(userId);
      if (!user) {
        throw AppError.notFound('Usuario no encontrado');
      }

      const person = this.guards.requirePerson(user);
      await this.profileHelper.deleteAccountLogic({
        userId,
        personId: person.personId,
        nationalId: person.nationalId,
        email: person.contact?.email,
        username: user.username,
        firstName: person.firstName,
        changedByUserId: auditCtx.adminUserId,
        changedByRole: 'admin',
        changeReason: 'Usuario interno eliminado por administrador',
        auditContext: { ipAddress: auditCtx.ipAddress, userAgent: auditCtx.userAgent }
      });
      return user;
    });

    // Tras el commit: cierra sesiones.
    await this.guards.invalidateSessions(userId, 'account_deleted');

    await audit.record('INTERNAL_USER_DELETED', {
      actorId: auditCtx.adminUserId,
      entityId: userId,
      entityType: 'InternalUser',
      entityTable: 'users'
    });

    const empleadoNombre = user.person?.firstName || 'Usuario';
    setImmediate(() => {
      this.notifier.notify({
        type: 'IAM_ADMIN_STATUS_CHANGED',
        userId: auditCtx.adminUserId,
        relatedEntity: { type: 'User', id: userId },
        metadata: { nombreUsuario: empleadoNombre, accion: 'eliminado', logoUrl: notifications.ses.logoUrl }
      }).catch(err => logger.warn('Error enviando IAM_ADMIN_STATUS_CHANGED (eliminación)', { error: err.message }));
    });

    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace InternalUserDeletionService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    unitOfWork?: typeof unitOfWork;
    userRepository?: typeof userRepository;
    profileHelper?: typeof ProfileHelper;
    notifier?: typeof notifier;
    DualApprovalService?: typeof DualApprovalService;
    guards?: InstanceType<typeof InternalUserGuards>;
  }
}

export default InternalUserDeletionService;
