// modules/schemas/kyc/maintainers/repositories/department.repository.ts
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../shared/application/pagination';
import { Prisma } from '../../../shared/infrastructure/database/generated/prisma/client';
import type { Department } from '../../../shared/infrastructure/database/generated/prisma/client';

const LIST = {
  tiebreaker: 'departmentId',
  searchFields: ['name'],
  filterId: { key: 'countryId', field: 'countryId' }
};
// Mismo include por defecto que en Sequelize: el país (id, nombre, código)
const WITH_COUNTRY = { country: { select: { countryId: true, name: true, code: true } } } satisfies Prisma.DepartmentInclude;

class DepartmentRepository extends PrismaRepository {
  async findById(departmentId: string): Promise<Department | null> {
    return (await this.db()).department.findUnique({ where: { departmentId } });
  }

  async findAllPaginated(
    filters: PrismaRepository.Filters = {},
    pagination: PageRequest,
    searchTerm: string | null = null
  ) {
    const { where, page } = this.listQuery(filters, pagination, searchTerm, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.department.findMany({ where: where as Prisma.DepartmentWhereInput, include: WITH_COUNTRY, ...page }),
      db.department.count({ where: where as Prisma.DepartmentWhereInput })
    ]);
    return { rows, count };
  }
}

export default new DepartmentRepository();
