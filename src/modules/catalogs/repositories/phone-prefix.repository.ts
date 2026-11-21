// modules/schemas/kyc/maintainers/repositories/phone-prefix.repository.ts
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { PageRequest } from '../../../shared/http/pagination';
import { Prisma } from '../../../shared/database/generated/prisma/client';
import type { PhonePrefix } from '../../../shared/database/generated/prisma/client';

const LIST = {
  tiebreaker: 'phonePrefixId',
  searchFields: ['prefix'],
  filterId: { key: 'countryId', field: 'countryId' }
};
// Mismo include por defecto que en Sequelize: el país (id, nombre, código)
const WITH_COUNTRY = { country: { select: { countryId: true, name: true, code: true } } } satisfies Prisma.PhonePrefixInclude;

class PhonePrefixRepository extends PrismaRepository {
  async findById(phonePrefixId: string): Promise<PhonePrefix | null> {
    return (await this.db()).phonePrefix.findUnique({ where: { phonePrefixId } });
  }

  async findAllPaginated(
    filters: PrismaRepository.Filters = {},
    pagination: PageRequest,
    searchTerm: string | null = null
  ) {
    const { where, page } = this.listQuery(filters, pagination, searchTerm, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.phonePrefix.findMany({ where: where as Prisma.PhonePrefixWhereInput, include: WITH_COUNTRY, ...page }),
      db.phonePrefix.count({ where: where as Prisma.PhonePrefixWhereInput })
    ]);
    return { rows, count };
  }

  /**
   * Resuelve un prefijo activo a partir del valor crudo del bureau.
   * Normaliza a solo dígitos y antepone '+' (en BD se guarda con '+', ej '+57').
   *
   * @param {string} rawPrefix - Prefijo del bureau (ej: '57')
   */
  async findActiveByPrefix(rawPrefix: string): Promise<PhonePrefix | null> {
    const digits = String(rawPrefix ?? '').replace(/\D/g, '');
    if (!digits) {
      return null;
    }
    return (await this.db()).phonePrefix.findFirst({ where: { prefix: `+${digits}`, isActive: true } });
  }
}

export default new PhonePrefixRepository();
