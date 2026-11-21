// Adaptadores: los catálogos que catalogs muestra pero son de otros módulos, leídos de sus repositorios y
// traducidos a las vistas de catalogs (domain/catalog-entries). Viven acá porque conectan dos módulos.
//
// Cuando iam, notification y legal se migren a Clean, estos adaptadores llamarán a sus casos de uso en
// vez de a sus repositorios; catalogs no cambia.
import iamModule from '../../modules/iam';
import notificationModule from '../../modules/notification';
import legalModule from '../../modules/legal';
import type { ActivePrivacyPolicyReader, CatalogReader } from '../../modules/catalogs/application/ports/catalog-reader.port';
import type { NotificationTypeEntry, RoleEntry } from '../../modules/catalogs/domain/catalog-entries';

export const roleCatalogAdapter: CatalogReader<RoleEntry> = {
  async list(filters, page, search) {
    const { rows, count } = await iamModule.roleRepository.findAllPaginated(filters, page, search ?? null);
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

export const notificationTypeCatalogAdapter: CatalogReader<NotificationTypeEntry> = {
  async list(filters, page, search) {
    const { rows, count } = await notificationModule.notificationTypeRepository.findAllPaginated(filters, page, search ?? null);
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

export const privacyPolicyCatalogAdapter: ActivePrivacyPolicyReader = {
  async findActive() {
    const policy = await legalModule.privacyPolicyRepository.findActive();
    return policy
      ? { version: policy.version, documentUrl: policy.documentUrl, summary: policy.summary, effectiveDate: policy.effectiveDate }
      : null;
  }
};
