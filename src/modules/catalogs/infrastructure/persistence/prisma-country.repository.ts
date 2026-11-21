// Adaptador Prisma del catálogo de países.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { CatalogFilters, CatalogPage, CatalogReader } from '../../application/ports/catalog-reader.port';
import type { Country } from '../../domain/catalog-entries';
import { CatalogMapper, mapOrNull } from './catalog.mapper';

const LIST = { tiebreaker: 'countryId', searchFields: ['name', 'code'] };

export class PrismaCountryRepository extends PrismaRepository implements CatalogReader<Country> {
  async list(filters: CatalogFilters, page: PageRequest, search: string | null = null): Promise<CatalogPage<Country>> {
    const { where, page: args } = this.listQuery(filters, page, search, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.country.findMany({ where: where as Prisma.CountryWhereInput, ...args }),
      db.country.count({ where: where as Prisma.CountryWhereInput })
    ]);
    return { rows: rows.map(CatalogMapper.country), count };
  }

  async findById(countryId: string): Promise<Country | null> {
    return mapOrNull(await (await this.db()).country.findUnique({ where: { countryId } }), CatalogMapper.country);
  }

  /** País activo por su código ISO (p. ej. 'COL'). */
  async findByCode(code: string): Promise<Country | null> {
    return mapOrNull(await (await this.db()).country.findFirst({ where: { code, isActive: true } }), CatalogMapper.country);
  }
}
