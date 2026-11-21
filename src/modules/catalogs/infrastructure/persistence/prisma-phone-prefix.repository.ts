// Adaptador Prisma del catálogo de prefijos telefónicos (con su país).
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { CatalogFilters, CatalogPage, CatalogReader } from '../../application/ports/catalog-reader.port';
import type { PhonePrefix } from '../../domain/catalog-entries';
import { normalizePhonePrefix } from '../../domain/location-names';
import { CatalogMapper, mapOrNull } from './catalog.mapper';

const LIST = { tiebreaker: 'phonePrefixId', searchFields: ['prefix'], filterId: { key: 'countryId', field: 'countryId' } };
const WITH_COUNTRY = { country: { select: { countryId: true, name: true, code: true } } } satisfies Prisma.PhonePrefixInclude;

export class PrismaPhonePrefixRepository extends PrismaRepository implements CatalogReader<PhonePrefix> {
  async list(filters: CatalogFilters, page: PageRequest, search: string | null = null): Promise<CatalogPage<PhonePrefix>> {
    const { where, page: args } = this.listQuery(filters, page, search, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.phonePrefix.findMany({ where: where as Prisma.PhonePrefixWhereInput, include: WITH_COUNTRY, ...args }),
      db.phonePrefix.count({ where: where as Prisma.PhonePrefixWhereInput })
    ]);
    return { rows: rows.map(CatalogMapper.phonePrefix), count };
  }

  async findById(phonePrefixId: string): Promise<PhonePrefix | null> {
    return mapOrNull(await (await this.db()).phonePrefix.findUnique({ where: { phonePrefixId } }), CatalogMapper.phonePrefix);
  }

  /** El prefijo activo para el valor que manda un tercero ('57' → '+57'). */
  async findActiveByPrefix(rawPrefix: string): Promise<PhonePrefix | null> {
    const prefix = normalizePhonePrefix(rawPrefix);
    if (!prefix) {
      return null;
    }
    return mapOrNull(
      await (await this.db()).phonePrefix.findFirst({ where: { prefix, isActive: true } }),
      CatalogMapper.phonePrefix
    );
  }
}
