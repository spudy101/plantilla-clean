// modules/schemas/kyc/maintainers/repositories/city.repository.ts
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../shared/application/pagination';
import { Prisma } from '../../../shared/infrastructure/database/generated/prisma/client';
import type { City } from '../../../shared/infrastructure/database/generated/prisma/client';

// Rango de diacríticos combinantes — para comparar nombres sin acentos ni mayúsculas
const DIACRITICS = /[̀-ͯ]/g;

function normalizeName(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// El bureau manda la ciudad sucia: 'BOGOTA ( BOGOTA DISTRITO CA ) '. Tomamos lo que
// va antes del primer paréntesis y normalizamos → 'BOGOTA'.
function cleanCityName(value: unknown) {
  return normalizeName(String(value ?? '').split('(')[0]);
}

// Coincidencia por palabra completa: el nombre del catálogo aparece como token
// dentro del string limpio del bureau (evita falsos positivos por substring).
function containsCityToken(haystack: string, cityName: string) {
  if (!cityName) {
    return false;
  }
  return ` ${haystack} `.includes(` ${cityName} `);
}

// Mismo include por defecto que en Sequelize: departamento (id, nombre) con su país
const WITH_DEPARTMENT = {
  department: {
    select: { departmentId: true, name: true, country: { select: { countryId: true, name: true, code: true } } }
  }
} satisfies Prisma.CityInclude;

const LIST = {
  tiebreaker: 'cityId',
  searchFields: ['name'],
  filterId: { key: 'departmentId', field: 'departmentId' }
};

class CityRepository extends PrismaRepository {
  async findById(cityId: string): Promise<City | null> {
    return (await this.db()).city.findUnique({ where: { cityId } });
  }

  async findAllPaginated(
    filters: PrismaRepository.Filters = {},
    pagination: PageRequest,
    searchTerm: string | null = null
  ) {
    const { where, page } = this.listQuery(filters, pagination, searchTerm, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.city.findMany({ where: where as Prisma.CityWhereInput, include: WITH_DEPARTMENT, ...page }),
      db.city.count({ where: where as Prisma.CityWhereInput })
    ]);
    return { rows, count };
  }

  /**
   * Resuelve una ciudad activa a partir del nombre (posiblemente sucio) que manda
   * el bureau, ej: 'BOGOTA ( BOGOTA DISTRITO CA ) '. Limpia el paréntesis, compara
   * sin acentos ni mayúsculas, y si no hay match exacto cae a coincidencia por
   * token. El catálogo es acotado; se compara en memoria (sin depender de unaccent).
   * El departmentId se obtiene de la misma fila.
   *
   * @param {string} name - Nombre de ciudad del bureau (ej: 'BOGOTA ( ... )', 'PACORA')
   */
  async findActiveByNormalizedName(name: string) {
    const target = cleanCityName(name);
    if (!target) {
      return null;
    }
    const cities = await (await this.db()).city.findMany({
      where: { isActive: true },
      select: { cityId: true, name: true, departmentId: true }
    });
    // 1) Match exacto sobre el nombre limpio
    const exact = cities.find(city => normalizeName(city.name) === target);
    if (exact) {
      return exact;
    }
    // 2) Fallback: el nombre del catálogo aparece como token dentro del string del bureau
    return cities.find(city => containsCityToken(target, normalizeName(city.name))) ?? null;
  }
}

export default new CityRepository();
