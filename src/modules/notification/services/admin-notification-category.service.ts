import type { NotificationCategoryInput } from '../repositories/notification-category.repository';
import notificationCategoryRepository from '../repositories/notification-category.repository';
import notificationTypeRepository from '../repositories/notification-type.repository';
import AppError from '../../../shared/http/app-error.util';
import adminNotificationCategoryDtoModule from '../responses/admin-notification-category.response';
import auditModule from '../../audit';
import type { NotificationCategoryDeleted } from '../responses/admin-notification-category.response';
import { pageMetadata, pageRequest } from '../../../shared/http/pagination';
import type { CategoryListQuery } from '../requests/notification.request';
const { audit } = auditModule;
const {
  NotificationCategoryAdminDTO,
  ListNotificationCategoriesResponseDTO
} = adminNotificationCategoryDtoModule;

const AUDIT_META = { entityType: 'NotificationCategory', entityTable: 'notification_categories' };

// Campos editables desde el panel (mismo nombre en la entrada y en el modelo); el validator ya los validó.
const EDITABLE = [
  'name',
  'description',
  'supportsPush',
  'supportsEmail',
  'supportsSms',
  'isCritical',
  'emailLayoutTemplate',
  'isActive'
] as const;

/** Solo los campos editables presentes en la entrada. */
function _toColumns(data: Record<string, unknown> = {}): NotificationCategoryInput {
  const columns: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    if (data[key] !== undefined) {
      columns[key] = data[key];
    }
  }
  return columns as NotificationCategoryInput;
}

class NotificationCategoryService {
  notificationCategoryRepository: typeof notificationCategoryRepository;
  notificationTypeRepository: typeof notificationTypeRepository;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new NotificationCategoryService({ notificationCategoryRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: NotificationCategoryService.Deps = {}) {
    this.notificationCategoryRepository = deps.notificationCategoryRepository ?? notificationCategoryRepository;
    this.notificationTypeRepository = deps.notificationTypeRepository ?? notificationTypeRepository;
  }

  async list(query: CategoryListQuery, adminUserId: string) {
    const page = pageRequest(query);
    const filters = { isActive: query.isActive ?? undefined, isCritical: query.isCritical ?? undefined };

    const { rows, count } = await this.notificationCategoryRepository.findAllPaginated(filters, page, query.search ?? null);

    await audit.record('NOTIFICATION_CATEGORY_LIST_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count },
      ...AUDIT_META
    });

    return ListNotificationCategoriesResponseDTO(rows, pageMetadata(page, count, { search: query.search, ...filters }));
  }

  async getById(notificationCategoryId: string, adminUserId: string) {
    const category = await this.notificationCategoryRepository.findById(notificationCategoryId);
    if (!category) {
      throw AppError.notFound('Categoría de notificación no encontrada');
    }
    await audit.record('NOTIFICATION_CATEGORY_VIEWED', {
      actorId: adminUserId,
      details: { code: category.code },
      ...AUDIT_META,
      entityId: notificationCategoryId
    });
    return NotificationCategoryAdminDTO(category);
  }

  async create(data: { code: string } & Record<string, unknown>, adminUserId: string) {
    const code = data.code.trim().toUpperCase();
    if (await this.notificationCategoryRepository.codeExists(code)) {
      throw AppError.badRequest(`Ya existe una categoría con el código ${code}`);
    }

    const category = await this.notificationCategoryRepository.create({ ..._toColumns(data), code } as NotificationCategoryInput & {
      code: string;
      name: string;
    });

    await audit.record('NOTIFICATION_CATEGORY_CREATED', {
      actorId: adminUserId,
      details: { code },
      ...AUDIT_META,
      entityId: category.notificationCategoryId
    });

    return NotificationCategoryAdminDTO(category);
  }

  async update(notificationCategoryId: string, data: Record<string, unknown>, adminUserId: string) {
    const category = await this.notificationCategoryRepository.findById(notificationCategoryId);
    if (!category) {
      throw AppError.notFound('Categoría de notificación no encontrada');
    }

    const columns = _toColumns(data);
    if (Object.keys(columns).length === 0) {
      return NotificationCategoryAdminDTO(category);
    }

    const updated = await this.notificationCategoryRepository.update(notificationCategoryId, columns);
    if (!updated) {
      throw AppError.notFound('Categoría de notificación no encontrada');
    }

    await audit.record('NOTIFICATION_CATEGORY_UPDATED', {
      actorId: adminUserId,
      details: { code: updated.code, updatedFields: Object.keys(columns) },
      ...AUDIT_META,
      entityId: notificationCategoryId
    });

    return NotificationCategoryAdminDTO(updated);
  }

  async remove(notificationCategoryId: string, adminUserId: string) {
    const category = await this.notificationCategoryRepository.findById(notificationCategoryId);
    if (!category) {
      throw AppError.notFound('Categoría de notificación no encontrada');
    }

    // No se borra una categoría que aún tiene tipos asignados: primero hay que reasignarlos.
    const assignedTypes = await this.notificationTypeRepository.countByCategory(notificationCategoryId);
    if (assignedTypes > 0) {
      throw AppError.badRequest(
        `No se puede eliminar: la categoría tiene ${assignedTypes} tipo(s) asignado(s). Reasignalos primero.`
      );
    }

    await this.notificationCategoryRepository.delete(notificationCategoryId);

    await audit.record('NOTIFICATION_CATEGORY_DELETED', {
      actorId: adminUserId,
      details: { code: category.code },
      ...AUDIT_META,
      entityId: notificationCategoryId
    });

    return { notificationCategoryId, deleted: true } satisfies NotificationCategoryDeleted;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace NotificationCategoryService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    notificationCategoryRepository?: typeof notificationCategoryRepository;
    notificationTypeRepository?: typeof notificationTypeRepository;
  }
}

export default Object.assign(new NotificationCategoryService(), { NotificationCategoryService });
