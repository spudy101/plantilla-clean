// Adaptadores Prisma de los puertos NotificationTypeRepository y NotificationCategoryRepository.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type {
  NotificationCategoryFilters,
  NotificationCategoryRepository,
  NotificationTypeFilters,
  NotificationTypeRepository,
  Page
} from '../../application/ports/notification-catalog-repository.port';
import type { CategoryChanges, NewCategory, NotificationCategory, NotificationType, TypeChanges } from '../../domain/notification-type';
import { NotificationMapper } from './notification.mapper';

const WITH_CATEGORY = { category: true } satisfies Prisma.NotificationTypeInclude;
const SEARCH_FIELDS = ['name', 'code', 'description'];

export class PrismaNotificationTypeRepository extends PrismaRepository implements NotificationTypeRepository {
  async findActiveByCode(code: string): Promise<NotificationType | null> {
    const row = await (await this.db()).notificationType.findFirst({ where: { code, isActive: true }, include: WITH_CATEGORY });
    return row ? NotificationMapper.typeToDomain(row) : null;
  }

  async findById(notificationTypeId: string): Promise<NotificationType | null> {
    const row = await (await this.db()).notificationType.findUnique({ where: { notificationTypeId }, include: WITH_CATEGORY });
    return row ? NotificationMapper.typeToDomain(row) : null;
  }

  async countByCategory(notificationCategoryId: string): Promise<number> {
    return (await this.db()).notificationType.count({ where: { notificationCategoryId } });
  }

  async list(filters: NotificationTypeFilters, pagination: PageRequest, search: string | null): Promise<Page<NotificationType>> {
    const { where, page } = this.listQuery(filters, pagination, search, {
      tiebreaker: 'notificationTypeId',
      searchFields: SEARCH_FIELDS,
      filterId: { key: 'notificationCategoryId', field: 'notificationCategoryId' }
    });
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.notificationType.findMany({ where: where as Prisma.NotificationTypeWhereInput, include: WITH_CATEGORY, ...page }),
      db.notificationType.count({ where: where as Prisma.NotificationTypeWhereInput })
    ]);
    return { rows: rows.map(NotificationMapper.typeToDomain), count };
  }

  async update(notificationTypeId: string, changes: TypeChanges): Promise<NotificationType | null> {
    const { count } = await (await this.db()).notificationType.updateMany({ where: { notificationTypeId }, data: changes });
    return count === 0 ? null : this.findById(notificationTypeId);
  }
}

export class PrismaNotificationCategoryRepository extends PrismaRepository implements NotificationCategoryRepository {
  async findById(notificationCategoryId: string): Promise<NotificationCategory | null> {
    const row = await (await this.db()).notificationCategory.findUnique({ where: { notificationCategoryId } });
    return row ? NotificationMapper.categoryToDomain(row) : null;
  }

  async codeExists(code: string): Promise<boolean> {
    return (await (await this.db()).notificationCategory.count({ where: { code } })) > 0;
  }

  async list(filters: NotificationCategoryFilters, pagination: PageRequest, search: string | null): Promise<Page<NotificationCategory>> {
    const { where, page } = this.listQuery(filters, pagination, search, { tiebreaker: 'notificationCategoryId', searchFields: SEARCH_FIELDS });
    if (filters.isCritical !== undefined) {
      where.isCritical = filters.isCritical;
    }
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.notificationCategory.findMany({ where: where as Prisma.NotificationCategoryWhereInput, ...page }),
      db.notificationCategory.count({ where: where as Prisma.NotificationCategoryWhereInput })
    ]);
    return { rows: rows.map(NotificationMapper.categoryToDomain), count };
  }

  async create(category: NewCategory): Promise<NotificationCategory> {
    return NotificationMapper.categoryToDomain(await (await this.db()).notificationCategory.create({ data: category }));
  }

  async update(notificationCategoryId: string, changes: CategoryChanges): Promise<NotificationCategory | null> {
    const [row] = await (await this.db()).notificationCategory.updateManyAndReturn({ where: { notificationCategoryId }, data: changes });
    return row ? NotificationMapper.categoryToDomain(row) : null;
  }

  async delete(notificationCategoryId: string): Promise<void> {
    await (await this.db()).notificationCategory.deleteMany({ where: { notificationCategoryId } });
  }
}
