// Adaptador Prisma del catálogo de géneros: implementa el puerto CatalogReader (application/ports) y las
// búsquedas puntuales que usan los módulos sin migrar.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { CatalogFilters, CatalogPage, CatalogReader } from '../../application/ports/catalog-reader.port';
import type { Gender } from '../../domain/catalog-entries';
import { CatalogMapper, mapOrNull } from './catalog.mapper';

const SEARCH_FIELDS = ['name'] as const;

export class PrismaGenderRepository extends PrismaRepository implements CatalogReader<Gender> {
  async list(filters: CatalogFilters, page: PageRequest, search: string | null = null): Promise<CatalogPage<Gender>> {
    const where: Prisma.GenderWhereInput = {
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...this.searchWhere(search, SEARCH_FIELDS)
    };
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.gender.findMany({ where, ...this.paginationArgs(page, 'genderId') }),
      db.gender.count({ where })
    ]);
    return { rows: rows.map(CatalogMapper.gender), count };
  }

  async findById(genderId: string): Promise<Gender | null> {
    return mapOrNull(await (await this.db()).gender.findUnique({ where: { genderId } }), CatalogMapper.gender);
  }

  /** true si hay al menos un género que cumple el criterio. */
  async exists(where: Prisma.GenderWhereInput): Promise<boolean> {
    return (await (await this.db()).gender.count({ where, take: 1 })) > 0;
  }
}
