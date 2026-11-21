// modules/schemas/kyc/maintainers/repositories/country.repository.ts
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { PageRequest } from '../../../shared/http/pagination';
import { Prisma } from '../../../shared/database/generated/prisma/client';
import type { Country } from '../../../shared/database/generated/prisma/client';

const LIST = { tiebreaker: 'countryId', searchFields: ['name', 'code'] };

class CountryRepository extends PrismaRepository {
  async findById(countryId: string): Promise<Country | null> {
    return (await this.db()).country.findUnique({ where: { countryId } });
  }

  async findByCode(code: string): Promise<Country | null> {
    return (await this.db()).country.findFirst({ where: { code, isActive: true } });
  }

  async findAllPaginated(
    filters: PrismaRepository.Filters = {},
    pagination: PageRequest,
    searchTerm: string | null = null
  ): Promise<PrismaRepository.Page<Country>> {
    const { where, page } = this.listQuery(filters, pagination, searchTerm, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.country.findMany({ where: where as Prisma.CountryWhereInput, ...page }),
      db.country.count({ where: where as Prisma.CountryWhereInput })
    ]);
    return { rows, count };
  }
}

export default new CountryRepository();
