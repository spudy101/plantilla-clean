// modules/admin/rbac/services/admin-rbac.service.ts
//
// Catálogo RBAC de solo lectura + gestión de overrides en runtime (RF-ADM-01).
//
// El catálogo (módulos, matriz, permisos propios) es para que el front oculte
// vistas; la autorización REAL la hace RbacMiddleware en el servidor.
//
// Los overrides se escriben en BD vía role-permission-override.repository y se
// invalida la caché Redis del rol afectado para que el cambio sea inmediato.

import RbacService from './rbac.service';
import AppError from '../../../shared/http/app-error.util';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../shared/constants';
const { RBAC_ROLES, notifications } = constantsModule;
import notificationModule from '../../notification';
const { notifier } = notificationModule;
import rolePermissionOverrideRepository from '../repositories/role-permission-override.repository';
import adminRbacDtoModule from '../responses/admin-rbac.response';
import auditModule from '../../audit';
import type { PermissionRevoked } from '../responses/admin-rbac.response';
const { audit } = auditModule;
const {
  RbacCatalogDTO,
  RoleMatrixDTO,
  EffectivePermissionsDTO,
  RolePermissionsListDTO,
  RolePermissionOverrideDTO
} = adminRbacDtoModule;

class AdminRbacService {
  RbacService: typeof RbacService;
  notifier: typeof notifier;
  rolePermissionOverrideRepository: typeof rolePermissionOverrideRepository;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new AdminRbacService({ RbacService: fake })
   * @param {object} [deps]
   */
  constructor(deps: AdminRbacService.Deps = {}) {
    this.RbacService = deps.RbacService ?? RbacService;
    this.notifier = deps.notifier ?? notifier;
    this.rolePermissionOverrideRepository = deps.rolePermissionOverrideRepository ?? rolePermissionOverrideRepository;
  }

  // ============================================================
  // CATÁLOGO (solo lectura)
  // ============================================================

  getCatalog(userId: string) {
    void audit.record('RBAC_CATALOG_VIEWED', { actorId: userId, entityType: 'RbacCatalog', entityTable: 'roles' });
    return RbacCatalogDTO(this.RbacService.listCatalog());
  }

  async getRoles(userId: string) {
    const roleNames = Object.values(RBAC_ROLES);
    await audit.record('RBAC_ROLES_VIEWED', { actorId: userId, entityType: 'RbacRole', entityTable: 'roles' });
    return RoleMatrixDTO(await this.RbacService.getRoleMatrix(roleNames));
  }

  async getEffectivePermissions(roleName: string | null, userId: string) {
    await audit.record('RBAC_EFFECTIVE_PERMISSIONS_VIEWED', {
      actorId: userId,
      details: { roleName },
      entityType: 'RbacRole',
      entityTable: 'roles'
    });
    // Sin rol en el token no hay permisos efectivos
    return EffectivePermissionsDTO(roleName, roleName ? await this.RbacService.getEffectivePermissions(roleName) : {});
  }

  // ============================================================
  // OVERRIDES — permisos adicionales por módulo (RF-ADM-01 criterio #1)
  // ============================================================

  /** Lista los overrides (permisos extra) definidos para un rol. */
  async listOverrides(roleName: string, userId: string) {
    this._assertValidRole(roleName);
    const overrides = await this.rolePermissionOverrideRepository.findByRole(roleName);
    await audit.record('RBAC_ROLE_PERMISSIONS_VIEWED', {
      actorId: userId,
      details: { roleName },
      entityType: 'RbacRole',
      entityTable: 'role_permission_overrides'
    });
    return RolePermissionsListDTO(roleName, overrides);
  }

  /**
   * Otorga un permiso adicional a un rol.
   * Solo el SUPERADMIN llega aquí (protegido por RbacMiddleware en la ruta).
   */
  async grantPermission(roleName: string, moduleName: string, action: string, grantedByUserId: string) {
    this._assertValidRole(roleName);

    const alreadyExists = await this.rolePermissionOverrideRepository.existsOverride(roleName, moduleName, action);
    if (alreadyExists) {
      throw AppError.conflict(`El rol '${roleName}' ya tiene el permiso '${action}' en '${moduleName}'`);
    }

    const override = await this.rolePermissionOverrideRepository.create({
      roleName,
      moduleName,
      action,
      grantedByUserId
    });

    await this.RbacService.invalidateCache(roleName);

    await audit.record('RBAC_PERMISSION_GRANTED', {
      actorId: grantedByUserId,
      details: {
        roleName,
        moduleName,
        action
      },
      entityId: override.rolePermissionOverrideId,
      entityType: 'RbacPermission',
      entityTable: 'role_permission_overrides'
    });

    setImmediate(() => {
      this.notifier.notify({
        type: 'IAM_RBAC_PERMISSION_GRANTED',
        userId: grantedByUserId,
        relatedEntity: { type: 'RolePermissionOverride', id: override.rolePermissionOverrideId },
        metadata: { roleName, moduleName, action, logoUrl: notifications.ses.logoUrl }
      }).catch(err => logger.warn('Error enviando IAM_RBAC_PERMISSION_GRANTED', { error: err.message }));
    });

    return RolePermissionOverrideDTO(override);
  }

  /**
   * Revoca un permiso adicional.
   * Solo el SUPERADMIN llega aquí (protegido por RbacMiddleware en la ruta).
   */
  async revokePermission(permissionId: string, adminUserId: string) {
    const override = await this.rolePermissionOverrideRepository.findById(permissionId);
    if (!override) {
      throw AppError.notFound('Permiso no encontrado');
    }

    await this.rolePermissionOverrideRepository.deleteById(permissionId);
    await this.RbacService.invalidateCache(override.roleName);

    await audit.record('RBAC_PERMISSION_REVOKED', {
      actorId: adminUserId,
      details: {
        roleName: override.roleName,
        moduleName: override.moduleName,
        action: override.action
      },
      entityId: permissionId,
      entityType: 'RbacPermission',
      entityTable: 'role_permission_overrides'
    });

    setImmediate(() => {
      this.notifier.notify({
        type: 'IAM_RBAC_PERMISSION_REVOKED',
        userId: adminUserId,
        relatedEntity: { type: 'RolePermissionOverride', id: permissionId },
        metadata: {
          roleName: override.roleName,
          moduleName: override.moduleName,
          action: override.action,
          logoUrl: notifications.ses.logoUrl
        }
      }).catch(err => logger.warn('Error enviando IAM_RBAC_PERMISSION_REVOKED', { error: err.message }));
    });

    return { deleted: true, permissionId } satisfies PermissionRevoked;
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  /** @private */
  _assertValidRole(roleName: string) {
    if (!Object.values(RBAC_ROLES).includes(roleName)) {
      throw AppError.badRequest(`El rol '${roleName}' no es un rol RBAC válido`);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace AdminRbacService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    RbacService?: typeof RbacService;
    notifier?: typeof notifier;
    rolePermissionOverrideRepository?: typeof rolePermissionOverrideRepository;
  }
}

export default Object.assign(new AdminRbacService(), { AdminRbacService });
