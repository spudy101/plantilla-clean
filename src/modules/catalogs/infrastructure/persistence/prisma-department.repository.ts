// Adaptador Prisma del catálogo de departamentos (con su país).
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { CatalogFilters, CatalogPage, CatalogReader } from '../../application/ports/catalog-reader.port';
import type { Department } from '../../domain/catalog-entries';
import { CatalogMapper, mapOrNull } from './catalog.mapper';

const LIST = { tiebreaker: 'departmentId', searchFields: ['name'], filterId: { key: 'countryId', field: 'countryId' } };
const WITH_COUNTRY = { country: { select: { countryId: true, name: true, code: true } } } satisfies Prisma.DepartmentInclude;

export class PrismaDepartmentRepository extends PrismaRepository implements CatalogReader<Department> {
  async list(filters: CatalogFilters, page: PageRequest, search: string | null = null): Promise<CatalogPage<Department>> {
    const { where, page: args } = this.listQuery(filters, page, search, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.department.findMany({ where: where as Prisma.DepartmentWhereInput, include: WITH_COUNTRY, ...args }),
      db.department.count({ where: where as Prisma.DepartmentWhereInput })
    ]);
    return { rows: rows.map(CatalogMapper.department), count };
  }

  async findById(departmentId: string): Promise<Department | null> {
    return mapOrNull(await (await this.db()).department.findUnique({ where: { departmentId } }), CatalogMapper.department);
  }
}
