// Adaptadores: los catálogos que catalogs muestra pero son de otros módulos, leídos con sus casos de uso y
// traducidos a las vistas de catalogs (domain/catalog-entries). Viven acá porque conectan módulos.
import type { ActivePrivacyPolicyReader, CatalogReader } from '../../modules/catalogs/application/ports/catalog-reader.port';
import type { NotificationTypeEntry, RoleEntry } from '../../modules/catalogs/domain/catalog-entries';
import type { ModuleRegistry } from './module-registry';

export function roleCatalogAdapter(modules: ModuleRegistry): CatalogReader<RoleEntry> {
  return {
    async list(filters, page, search) {
      const { rows, count } = await modules.iam.directories.roles.list(filters, page, search ?? null);
      return {
        count,
        rows: rows.map(role => ({
          roleId: role.roleId,
          name: role.name,
          description: role.description,
          isActive: role.isActive,
          createdAt: role.createdAt,
          updatedAt: role.updatedAt
        }))
      };
    }
  };
}

export function notificationTypeCatalogAdapter(modules: ModuleRegistry): CatalogReader<NotificationTypeEntry> {
  return {
    async list(filters, page, search) {
      const { rows, count } = await modules.notification.useCases.listNotificationTypes.execute(filters, page, search ?? null);
      return {
        count,
        rows: rows.map(type => ({
          notificationTypeId: type.notificationTypeId,
          code: type.code,
          name: type.name,
          description: type.description,
          notificationCategoryId: type.notificationCategoryId,
          isActive: type.isActive,
          ...(type.category
            ? {
                category: {
                  notificationCategoryId: type.category.notificationCategoryId,
                  code: type.category.code,
                  name: type.category.name,
                  description: type.category.description,
                  supportsPush: type.category.supportsPush,
                  supportsEmail: type.category.supportsEmail,
                  supportsSms: type.category.supportsSms,
                  isCritical: type.category.isCritical,
                  isActive: type.category.isActive
                }
              }
            : {})
        }))
      };
    }
  };
}

export function privacyPolicyCatalogAdapter(modules: ModuleRegistry): ActivePrivacyPolicyReader {
  return {
    async findActive() {
      const policy = await modules.legal.useCases.findActivePrivacyPolicy.execute();
      return policy ? { version: policy.version, documentUrl: policy.documentUrl, summary: policy.summary, effectiveDate: policy.effectiveDate } : null;
    }
  };
}
