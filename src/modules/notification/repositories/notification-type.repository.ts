// modules/schemas/notification/repositories/notification-type.repository.ts
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { PageRequest } from '../../../shared/http/pagination';
import { Prisma } from '../../../shared/database/generated/prisma/client';
import type { NotificationType } from '../../../shared/database/generated/prisma/client';
import type { NotificationCategoryRow } from './notification-category.repository';

/** Tipo con su categoría (canales, criticidad y layout de email viven en la categoría). */
export type NotificationTypeWithCategory = NotificationType & { category: NotificationCategoryRow | null };

const WITH_CATEGORY = { category: true } satisfies Prisma.NotificationTypeInclude;

const LIST = { tiebreaker: 'notificationTypeId', searchFields: ['name', 'code', 'description'] };

class NotificationTypeRepository extends PrismaRepository {
  /** Tipo activo por código, con su categoría. */
  async findByCode(code: string): Promise<NotificationTypeWithCategory | null> {
    const row = await (await this.db()).notificationType.findFirst({ where: { code, isActive: true }, include: WITH_CATEGORY });
    return row;
  }

  async findById(notificationTypeId: string): Promise<NotificationTypeWithCategory | null> {
    const row = await (await this.db()).notificationType.findUnique({ where: { notificationTypeId }, include: WITH_CATEGORY });
    return row;
  }

  async countByCategory(notificationCategoryId: string): Promise<number> {
    return (await this.db()).notificationType.count({ where: { notificationCategoryId } });
  }

  /** Listado paginado para el admin. Filtros: isActive, notificationCategoryId. */
  async findAllPaginated(
    filters: PrismaRepository.Filters = {},
    pagination: PageRequest,
    searchTerm: string | null = null
  ): Promise<PrismaRepository.Page<NotificationTypeWithCategory>> {
    const { where, page } = this.listQuery(filters, pagination, searchTerm, {
      ...LIST,
      filterId: { key: 'notificationCategoryId', field: 'notificationCategoryId' }
    });
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.notificationType.findMany({ where: where as Prisma.NotificationTypeWhereInput, include: WITH_CATEGORY, ...page }),
      db.notificationType.count({ where: where as Prisma.NotificationTypeWhereInput })
    ]);
    return { rows: rows, count };
  }

  /** null si la fila ya no existe. Devuelve el tipo con su categoría (para la respuesta del admin). */
  async update(
    notificationTypeId: string,
    data: Pick<Prisma.NotificationTypeUncheckedUpdateInput, 'name' | 'description' | 'notificationCategoryId'>
  ): Promise<NotificationTypeWithCategory | null> {
    const db = await this.db();
    const { count } = await db.notificationType.updateMany({ where: { notificationTypeId }, data });
    return count === 0 ? null : this.findById(notificationTypeId);
  }
}

export default new NotificationTypeRepository();
