// modules/admin/kyc/person/services/admin-person/person-access.service.ts
//
// Control de acceso de una cuenta: activar/desactivar y cambio de rol.
// Extraído de PersonService (SOLID: S).

import type { AdminAuditContext } from '../../../../shared/application/audit-context';
import unitOfWork from '../../../../shared/infrastructure/database/unit-of-work';
import iamModule from '../../../iam';
const { userRepository, roleRepository } = iamModule;
import KycSharedUtil from '../../utils/kyc-shared.util';
import notificationModule from '../../../notification';
const { notifier } = notificationModule;
import AppError from '../../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../../shared/infrastructure/config';
const { notifications } = constantsModule;

import adminPersonDtoModule from '../../responses/admin-person.response';
const { ToggleUserStatusDTO, ChangeRoleDTO } = adminPersonDtoModule;
import personGuardsModule from './person-guards';
const { assertNotDeleted, isClientRole } = personGuardsModule;
import auditModule from '../../../audit';
const { audit } = auditModule;

class PersonAccessService {
  unitOfWork: typeof unitOfWork;
  userRepository: typeof userRepository;
  roleRepository: typeof roleRepository;
  notifier: typeof notifier;

  /**
   * @param {object} [deps] Dependencias inyectables (SOLID: D). Las provee la fachada
   *   PersonService; por defecto se usan las implementaciones reales.
   */
  constructor(deps: PersonAccessService.Deps = {}) {
    this.unitOfWork = deps.unitOfWork ?? unitOfWork;
    this.userRepository = deps.userRepository ?? userRepository;
    this.roleRepository = deps.roleRepository ?? roleRepository;
    this.notifier = deps.notifier ?? notifier;
  }

  // ============================================================
  // ACTIVAR / DESACTIVAR
  // ============================================================

  activate(userId: string, auditContext: AdminAuditContext) {
    return this._toggleStatus(userId, 'activate', auditContext);
  }

  deactivate(userId: string, auditContext: AdminAuditContext) {
    return this._toggleStatus(userId, 'deactivate', auditContext);
  }

  async _toggleStatus(userId: string, action: 'activate' | 'deactivate', auditContext: AdminAuditContext) {
    const isActivating = action === 'activate';
    const user = await this.unitOfWork.run(async () => {
      const user = await this.userRepository.findAdminTarget(userId);

      if (!user) {
        throw AppError.notFound('Usuario no encontrado');
      }
      assertNotDeleted(user);

      if (user.isActive === isActivating) {
        throw AppError.badRequest(`El usuario ya está ${isActivating ? 'activo' : 'inactivo'}`);
      }

      await this.userRepository.setActiveStatus(userId, isActivating);

      await KycSharedUtil.logChange({
        userId: user.userId,
        changedByUserId: auditContext.adminUserId,
        changedByRole: 'admin',
        changeType: 'account_status',
        previousValue: isActivating ? 'inactive' : 'active',
        newValue: isActivating ? 'active' : 'inactive',
        changeReason: `Usuario ${isActivating ? 'activado' : 'desactivado'} por administrador`,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent
      });
      return user;
    });

    await audit.record(isActivating ? 'PERSON_ACTIVATED' : 'PERSON_DEACTIVATED', {
      actorId: auditContext.adminUserId,
      details: { before: { isActive: !isActivating }, after: { isActive: isActivating } },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    const affectedNombre = user.person?.firstName || 'Usuario';
    const affectedEmail = user.person?.contact?.email;

    setImmediate(() => {
      this.notifier.notify({
        type: isActivating ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_DEACTIVATED',
        userId: userId,
        relatedEntity: null,
        metadata: {
          nombre: affectedNombre,
          email: affectedEmail,
          logoUrl: notifications.ses.logoUrl
        }
      }).catch(err => logger.warn('Error sending status notification', { error: err.message }));

      this.notifier.notify({
        type: 'PERSON_ADMIN_ACTION',
        userId: auditContext.adminUserId,
        relatedEntity: null,
        metadata: {
          nombre: auditContext.adminFirstName,
          accion: action,
          userId: userId,
          logoUrl: notifications.ses.logoUrl
        }
      }).catch(err => logger.warn('Error sending admin action notification', { error: err.message }));
    });

    user.isActive = isActivating;
    return ToggleUserStatusDTO(user, action);
  }

  // ============================================================
  // CAMBIAR ROL
  // ============================================================

  async changeRole(userId: string, newRoleId: string, auditContext: AdminAuditContext) {
    const { user, newRole, oldRole } = await this.unitOfWork.run(async () => {
      const user = await this.userRepository.findAdminTarget(userId);

      if (!user) {
        throw AppError.notFound('Usuario no encontrado');
      }
      assertNotDeleted(user);

      // Antes: `user.role.name === 'admin'` (los roles son MAYÚSCULAS → nunca coincidía) y sin límite sobre
      // el rol nuevo. Este endpoint podía cambiar el rol de un ADMIN/SUPERADMIN o promover un cliente a
      // interno, salteando la doble aprobación de admin-user. Solo opera entre roles de cliente.
      if (!isClientRole(user.role?.name)) {
        throw AppError.forbidden('Solo se puede cambiar el rol de una cuenta de cliente');
      }

      const newRole = await this.roleRepository.findById(newRoleId);
      if (!newRole) {
        throw AppError.notFound('Rol no encontrado');
      }
      if (!isClientRole(newRole.name)) {
        throw AppError.badRequest('El rol indicado no es un rol de cliente');
      }

      if (user.roleId === newRoleId) {
        throw AppError.badRequest('El usuario ya tiene este rol');
      }

      const oldRole = user.role ?? null;

      await this.userRepository.update(userId, { roleId: newRoleId });

      await KycSharedUtil.logChange({
        userId: user.userId,
        changedByUserId: auditContext.adminUserId,
        changedByRole: 'admin',
        changeType: 'role',
        previousValue: oldRole?.name ?? null,
        newValue: newRole.name,
        changeReason: 'Rol actualizado por administrador',
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent
      });
      return { user, newRole, oldRole };
    });

    await audit.record('PERSON_ROLE_CHANGED', {
      actorId: auditContext.adminUserId,
      details: {
        before: { role: oldRole?.name ?? null },
        after: { role: newRole.name }
      },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    const affectedNombre = user.person?.firstName || 'Usuario';
    const affectedEmail = user.person?.contact?.email;

    setImmediate(() => {
      this.notifier.notify({
        type: 'ROL_CHANGE',
        userId: user.userId,
        relatedEntity: null,
        metadata: {
          nombre: affectedNombre,
          email: affectedEmail,
          nuevo_rol: newRole.name,
          permisos_descripcion: newRole.description,
          logoUrl: notifications.ses.logoUrl
        }
      }).catch(err => logger.warn('Error sending role change notification', { error: err.message }));

      this.notifier.notify({
        type: 'PERSON_ADMIN_ACTION',
        userId: auditContext.adminUserId,
        relatedEntity: null,
        metadata: {
          nombre: auditContext.adminFirstName,
          accion: 'cambiar_rol',
          userId: userId,
          logoUrl: notifications.ses.logoUrl
        }
      }).catch(err => logger.warn('Error sending admin action notification', { error: err.message }));
    });
    return ChangeRoleDTO(user, oldRole, newRole);
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace PersonAccessService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    unitOfWork?: typeof unitOfWork;
    userRepository?: typeof userRepository;
    roleRepository?: typeof roleRepository;
    notifier?: typeof notifier;
  }
}

export default PersonAccessService;
