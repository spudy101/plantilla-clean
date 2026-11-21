// modules/schemas/kyc/maintainers/repositories/gender.repository.ts
//
// Primer repositorio sobre Prisma (fase 0 de docs/prisma-migration.md): catálogo de géneros.
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { PageRequest } from '../../../shared/http/pagination';
import { Prisma } from '../../../shared/database/generated/prisma/client';
import type { Gender } from '../../../shared/database/generated/prisma/client';

const SEARCH_FIELDS = ['name'] as const;

class GenderRepository extends PrismaRepository {
  async findById(genderId: string): Promise<Gender | null> {
    return (await this.db()).gender.findUnique({ where: { genderId } });
  }

  /** true si hay al menos un género que cumple el criterio. */
  async exists(where: Prisma.GenderWhereInput): Promise<boolean> {
    return (await (await this.db()).gender.count({ where, take: 1 })) > 0;
  }

  /** Listado paginado del catálogo (mismo contrato que ReadRepository#findAllPaginated). */
  async findAllPaginated(
    filters: PrismaRepository.Filters = {},
    pagination: PageRequest,
    searchTerm: string | null = null
  ): Promise<{ rows: Gender[]; count: number }> {
    const where: Prisma.GenderWhereInput = {
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...this.searchWhere(searchTerm, SEARCH_FIELDS)
    };
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.gender.findMany({ where, ...this.paginationArgs(pagination, 'genderId') }),
      db.gender.count({ where })
    ]);
    return { rows, count };
  }
}

export default new GenderRepository();
