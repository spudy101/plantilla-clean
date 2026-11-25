// Panel admin de las categorías (canales, criticidad, layout) y de los tipos de notificación (nombre,
// descripción y categoría; las plantillas son de solo lectura por la API).
import { pageMetadata, pageRequest, type PageQuery } from '../../../../shared/application/pagination';
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { categoryChanges, normalizeCategoryCode, typeChanges } from '../../domain/notification-type';
import {
  CategoryCodeTakenError,
  CategoryInUseError,
  NotificationCategoryNotFoundError,
  NotificationTypeNotFoundError,
  UnknownCategoryError
} from '../../domain/errors';
import { toCategoryAdminOutput, toTypeAdminOutput } from '../dto/admin-notification.output';
import type { NotificationCategoryRepository, NotificationTypeRepository } from '../ports/notification-catalog-repository.port';

const CATEGORY = { entityType: 'NotificationCategory', entityTable: 'notification_categories' } as const;
const TYPE = { entityType: 'NotificationType', entityTable: 'notification_types' } as const;

type ListQuery = PageQuery & { search?: string | null };

// ── Categorías ────────────────────────────────────────────────

export class ListNotificationCategories {
  constructor(
    private readonly categories: NotificationCategoryRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, query }: { actorId: string; query: ListQuery & { isActive?: boolean | null; isCritical?: boolean | null } }) {
    const page = pageRequest(query);
    const filters = { isActive: query.isActive ?? undefined, isCritical: query.isCritical ?? undefined };
    const { rows, count } = await this.categories.list(filters, page, query.search ?? null);
    await this.audit.record('NOTIFICATION_CATEGORY_LIST_VIEWED', { actorId, details: { totalItems: count }, ...CATEGORY });
    return { data: rows.map(toCategoryAdminOutput), metadata: pageMetadata(page, count, { search: query.search, ...filters }) };
  }
}

export class GetNotificationCategory {
  constructor(
    private readonly categories: NotificationCategoryRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, notificationCategoryId }: { actorId: string; notificationCategoryId: string }) {
    const category = await this.categories.findById(notificationCategoryId);
    if (!category) {
      throw new NotificationCategoryNotFoundError();
    }
    await this.audit.record('NOTIFICATION_CATEGORY_VIEWED', {
      actorId,
      details: { code: category.code },
      ...CATEGORY,
      entityId: notificationCategoryId
    });
    return toCategoryAdminOutput(category);
  }
}

export class CreateNotificationCategory {
  constructor(
    private readonly categories: NotificationCategoryRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, data }: { actorId: string; data: { code: string; name: string } & Record<string, unknown> }) {
    const code = normalizeCategoryCode(data.code);
    if (await this.categories.codeExists(code)) {
      throw new CategoryCodeTakenError(code);
    }
    const category = await this.categories.create({ ...categoryChanges(data), name: data.name, code } as Parameters<
      NotificationCategoryRepository['create']
    >[0]);
    await this.audit.record('NOTIFICATION_CATEGORY_CREATED', {
      actorId,
      details: { code },
      ...CATEGORY,
      entityId: category.notificationCategoryId
    });
    return toCategoryAdminOutput(category);
  }
}

export class UpdateNotificationCategory {
  constructor(
    private readonly categories: NotificationCategoryRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, notificationCategoryId, data }: { actorId: string; notificationCategoryId: string; data: Record<string, unknown> }) {
    const category = await this.categories.findById(notificationCategoryId);
    if (!category) {
      throw new NotificationCategoryNotFoundError();
    }
    const changes = categoryChanges(data);
    if (Object.keys(changes).length === 0) {
      return toCategoryAdminOutput(category);
    }
    const updated = await this.categories.update(notificationCategoryId, changes);
    if (!updated) {
      throw new NotificationCategoryNotFoundError();
    }
    await this.audit.record('NOTIFICATION_CATEGORY_UPDATED', {
      actorId,
      details: { code: updated.code, updatedFields: Object.keys(changes) },
      ...CATEGORY,
      entityId: notificationCategoryId
    });
    return toCategoryAdminOutput(updated);
  }
}

export class DeleteNotificationCategory {
  constructor(
    private readonly categories: NotificationCategoryRepository,
    private readonly types: Pick<NotificationTypeRepository, 'countByCategory'>,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, notificationCategoryId }: { actorId: string; notificationCategoryId: string }) {
    const category = await this.categories.findById(notificationCategoryId);
    if (!category) {
      throw new NotificationCategoryNotFoundError();
    }
    // Una categoría con tipos asignados no se borra: primero hay que reasignarlos.
    const assignedTypes = await this.types.countByCategory(notificationCategoryId);
    if (assignedTypes > 0) {
      throw new CategoryInUseError(assignedTypes);
    }
    await this.categories.delete(notificationCategoryId);
    await this.audit.record('NOTIFICATION_CATEGORY_DELETED', {
      actorId,
      details: { code: category.code },
      ...CATEGORY,
      entityId: notificationCategoryId
    });
    return { notificationCategoryId, deleted: true as const };
  }
}

// ── Tipos ─────────────────────────────────────────────────────

export class ListNotificationTypes {
  constructor(
    private readonly types: NotificationTypeRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, query }: { actorId: string; query: ListQuery & { isActive?: boolean | null; notificationCategoryId?: string | null } }) {
    const page = pageRequest(query);
    const filters = { isActive: query.isActive ?? undefined, notificationCategoryId: query.notificationCategoryId ?? undefined };
    const { rows, count } = await this.types.list(filters, page, query.search ?? null);
    await this.audit.record('NOTIFICATION_TYPE_LIST_VIEWED', { actorId, details: { totalItems: count, page: page.page }, ...TYPE });
    return { data: rows.map(toTypeAdminOutput), metadata: pageMetadata(page, count, { search: query.search, ...filters }) };
  }
}

export class UpdateNotificationType {
  constructor(
    private readonly types: NotificationTypeRepository,
    private readonly categories: Pick<NotificationCategoryRepository, 'findById'>,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, notificationTypeId, data }: { actorId: string; notificationTypeId: string; data: Record<string, unknown> }) {
    const type = await this.types.findById(notificationTypeId);
    if (!type) {
      throw new NotificationTypeNotFoundError();
    }
    // Si se reasigna la categoría, que exista (además de la FK) para dar un error claro.
    if (typeof data.notificationCategoryId === 'string' && data.notificationCategoryId) {
      if (!(await this.categories.findById(data.notificationCategoryId))) {
        throw new UnknownCategoryError();
      }
    }
    const changes = typeChanges(data);
    if (Object.keys(changes).length === 0) {
      return toTypeAdminOutput(type);
    }
    const updated = await this.types.update(notificationTypeId, changes);
    if (!updated) {
      throw new NotificationTypeNotFoundError();
    }
    await this.audit.record('NOTIFICATION_TYPE_UPDATED', {
      actorId,
      details: { code: updated.code, updatedFields: Object.keys(changes) },
      entityId: notificationTypeId,
      ...TYPE
    });
    return toTypeAdminOutput(updated);
  }
}
