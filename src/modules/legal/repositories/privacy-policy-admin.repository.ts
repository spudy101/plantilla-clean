// modules/schemas/records/legal/repositories/privacy-policy-admin.repository.ts
//
// Capacidades de administración de PrivacyPolicy: paginación, búsqueda, detalle y publicación de
// versiones. El repositorio público (privacy-policy.repository) solo lee.
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { PageRequest } from '../../../shared/http/pagination';
import { Prisma } from '../../../shared/database/generated/prisma/client';
import type { PrivacyPolicy } from '../../../shared/database/generated/prisma/client';

const LIST = { tiebreaker: 'privacyPolicyId', searchFields: ['version', 'summary'] };

class PrivacyPolicyAdminRepository extends PrismaRepository {
  async findById(privacyPolicyId: string): Promise<PrivacyPolicy | null> {
    return (await this.db()).privacyPolicy.findUnique({ where: { privacyPolicyId } });
  }

  async findByVersion(version: string): Promise<PrivacyPolicy | null> {
    return (await this.db()).privacyPolicy.findUnique({ where: { version } });
  }

  /** Listado paginado; sin `sortBy` ordena por fecha de vigencia. */
  async findAllPaginated(
    filters: PrismaRepository.Filters = {},
    pagination: PageRequest,
    searchTerm: string | null = null
  ): Promise<PrismaRepository.Page<PrivacyPolicy>> {
    const { where, page } = this.listQuery(
      filters,
      { ...pagination, sortBy: pagination.sortBy || 'effectiveDate' },
      searchTerm,
      LIST
    );
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.privacyPolicy.findMany({ where: where as Prisma.PrivacyPolicyWhereInput, ...page }),
      db.privacyPolicy.count({ where: where as Prisma.PrivacyPolicyWhereInput })
    ]);
    return { rows, count };
  }

  /**
   * Publica una versión: desactiva la activa y crea la nueva como activa, en una sola transacción
   * (solo puede haber UNA versión activa; con Sequelize eran dos escrituras sueltas).
   */
  createVersion(data: Omit<Prisma.PrivacyPolicyUncheckedCreateInput, 'isActive'>): Promise<PrivacyPolicy> {
    return this.atomic(async db => {
      await db.privacyPolicy.updateMany({ where: { isActive: true }, data: { isActive: false } });
      return db.privacyPolicy.create({ data: { ...data, isActive: true } });
    });
  }
}

export default new PrivacyPolicyAdminRepository();
