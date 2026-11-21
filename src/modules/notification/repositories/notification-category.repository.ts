// Categorías de notificación: fuente de verdad de los canales (push/email/sms), de la criticidad
// (crítica = se envía siempre, sin mirar preferencias ni horario de silencio) y del layout del email.
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { PageRequest } from '../../../shared/http/pagination';
import { Prisma } from '../../../shared/database/generated/prisma/client';
import type { NotificationCategory } from '../../../shared/database/generated/prisma/client';

export type NotificationCategoryRow = NotificationCategory;
/** Datos de alta/edición. */
export type NotificationCategoryInput = Prisma.NotificationCategoryUncheckedUpdateManyInput;

const LIST = {
  tiebreaker: 'notificationCategoryId',
  searchFields: ['name', 'code', 'description']
};

class NotificationCategoryRepository extends PrismaRepository {
  async findById(notificationCategoryId: string): Promise<NotificationCategoryRow | null> {
    return (await this.db()).notificationCategory.findUnique({ where: { notificationCategoryId } });
  }

  async findByCode(code: string): Promise<NotificationCategoryRow | null> {
    return (await this.db()).notificationCategory.findUnique({ where: { code } });
  }

  async codeExists(code: string): Promise<boolean> {
    return (await (await this.db()).notificationCategory.count({ where: { code } })) > 0;
  }

  /** Listado paginado para el admin. Filtros: isActive, isCritical. */
  async findAllPaginated(
    filters: PrismaRepository.Filters = {},
    pagination: PageRequest,
    searchTerm: string | null = null
  ): Promise<PrismaRepository.Page<NotificationCategoryRow>> {
    const { where, page } = this.listQuery(filters, pagination, searchTerm, LIST);
    if (filters.isCritical !== undefined) {
      where.isCritical = filters.isCritical;
    }
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.notificationCategory.findMany({ where: where as Prisma.NotificationCategoryWhereInput, ...page }),
      db.notificationCategory.count({ where: where as Prisma.NotificationCategoryWhereInput })
    ]);
    return { rows, count };
  }

  async create(data: NotificationCategoryInput & { code: string; name: string }): Promise<NotificationCategoryRow> {
    return (await this.db()).notificationCategory.create({ data: data as Prisma.NotificationCategoryUncheckedCreateInput });
  }

  /** null si la fila ya no existe. */
  async update(notificationCategoryId: string, data: NotificationCategoryInput): Promise<NotificationCategoryRow | null> {
    const [row] = await (await this.db()).notificationCategory.updateManyAndReturn({ where: { notificationCategoryId }, data });
    return row ?? null;
  }

  /** Cantidad de filas borradas (0 si no existía). */
  async delete(notificationCategoryId: string): Promise<number> {
    return (await (await this.db()).notificationCategory.deleteMany({ where: { notificationCategoryId } })).count;
  }
}

export default new NotificationCategoryRepository();
