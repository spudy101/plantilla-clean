// Adaptador Prisma del catálogo de ciudades (con su departamento y país).
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { CatalogFilters, CatalogPage, CatalogReader } from '../../application/ports/catalog-reader.port';
import type { City } from '../../domain/catalog-entries';
import { matchCityByName } from '../../domain/location-names';
import { CatalogMapper, mapOrNull } from './catalog.mapper';

const LIST = { tiebreaker: 'cityId', searchFields: ['name'], filterId: { key: 'departmentId', field: 'departmentId' } };
const WITH_DEPARTMENT = {
  department: { select: { departmentId: true, name: true, country: { select: { countryId: true, name: true, code: true } } } }
} satisfies Prisma.CityInclude;

export class PrismaCityRepository extends PrismaRepository implements CatalogReader<City> {
  async list(filters: CatalogFilters, page: PageRequest, search: string | null = null): Promise<CatalogPage<City>> {
    const { where, page: args } = this.listQuery(filters, page, search, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.city.findMany({ where: where as Prisma.CityWhereInput, include: WITH_DEPARTMENT, ...args }),
      db.city.count({ where: where as Prisma.CityWhereInput })
    ]);
    return { rows: rows.map(CatalogMapper.city), count };
  }

  async findById(cityId: string): Promise<City | null> {
    return mapOrNull(await (await this.db()).city.findUnique({ where: { cityId } }), CatalogMapper.city);
  }

  /**
   * La ciudad activa que corresponde a un nombre "sucio" de un tercero (p. ej. 'BOGOTA ( BOGOTA DISTRITO CA )').
   * El repositorio solo trae las activas (el catálogo es acotado); cuál coincide lo decide el dominio.
   */
  async findActiveByName(rawName: string): Promise<Pick<City, 'cityId' | 'name' | 'departmentId'> | null> {
    const cities = await (
      await this.db()
    ).city.findMany({
      where: { isActive: true },
      select: { cityId: true, name: true, departmentId: true }
    });
    return matchCityByName(cities, rawName);
  }
}
