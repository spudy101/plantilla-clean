// prisma/seeds/geography.seed.ts
//
// Países, prefijos telefónicos y la división política de Colombia (departamentos y ciudades con
// códigos DANE). Países por `code`; prefijos por (prefix, país); departamentos por (país, nombre);
// ciudades por (departamento, nombre).
import { CITIES, DEPARTMENTS } from './data/colombia';
import { reportCreated, type SeedClient } from './seed-client';

const COUNTRIES = [
  { code: 'COL', name: 'Colombia', iconUrl: 'https://flagcdn.com/co.svg', prefix: '+57' },
  { code: 'USA', name: 'Estados Unidos', iconUrl: 'https://flagcdn.com/us.svg', prefix: '+1' },
  { code: 'MEX', name: 'México', iconUrl: 'https://flagcdn.com/mx.svg', prefix: '+52' },
  { code: 'ARG', name: 'Argentina', iconUrl: 'https://flagcdn.com/ar.svg', prefix: '+54' },
  { code: 'CHL', name: 'Chile', iconUrl: 'https://flagcdn.com/cl.svg', prefix: '+56' },
  { code: 'PER', name: 'Perú', iconUrl: 'https://flagcdn.com/pe.svg', prefix: '+51' },
  { code: 'BRA', name: 'Brasil', iconUrl: 'https://flagcdn.com/br.svg', prefix: '+55' },
  { code: 'ESP', name: 'España', iconUrl: 'https://flagcdn.com/es.svg', prefix: '+34' }
];

export async function seedGeography(db: SeedClient): Promise<void> {
  const { count: countries } = await db.country.createMany({
    data: COUNTRIES.map(({ code, name, iconUrl }) => ({ code, name, iconUrl })),
    skipDuplicates: true
  });
  reportCreated('Países', countries, COUNTRIES.length);

  const countryIds = new Map(
    (
      await db.country.findMany({ where: { code: { in: COUNTRIES.map(c => c.code) } }, select: { code: true, countryId: true } })
    ).map(c => [c.code, c.countryId])
  );

  // phone_prefixes no tiene UNIQUE: se filtra lo que ya existe
  const existingPrefixes = await db.phonePrefix.findMany({ select: { prefix: true, countryId: true } });
  const prefixKey = (prefix: string, countryId: string) => `${countryId}|${prefix}`;
  const knownPrefixes = new Set(existingPrefixes.map(p => prefixKey(p.prefix, p.countryId)));
  const newPrefixes = COUNTRIES.map(c => ({ prefix: c.prefix, countryId: countryIds.get(c.code)! })).filter(
    p => !knownPrefixes.has(prefixKey(p.prefix, p.countryId))
  );
  await db.phonePrefix.createMany({ data: newPrefixes });
  reportCreated('Prefijos telefónicos', newPrefixes.length, COUNTRIES.length);

  const colombiaId = countryIds.get('COL')!;
  const existingDepartments = await db.department.findMany({ where: { countryId: colombiaId }, select: { name: true } });
  const knownDepartments = new Set(existingDepartments.map(d => d.name));
  const newDepartments = DEPARTMENTS.filter(d => !knownDepartments.has(d.name));
  await db.department.createMany({
    data: newDepartments.map(d => ({ name: d.name, daneCode: d.daneCode, countryId: colombiaId }))
  });
  reportCreated('Departamentos de Colombia', newDepartments.length, DEPARTMENTS.length);

  const departments = await db.department.findMany({
    where: { countryId: colombiaId },
    select: { name: true, departmentId: true }
  });
  const departmentIds = new Map(departments.map(d => [d.name, d.departmentId]));
  const existingCities = await db.city.findMany({
    where: { departmentId: { in: [...departmentIds.values()] } },
    select: { name: true, departmentId: true }
  });
  const cityKey = (departmentId: string, name: string) => `${departmentId}|${name}`;
  const knownCities = new Set(existingCities.map(c => cityKey(c.departmentId, c.name)));
  const newCities = CITIES.map(c => ({
    name: c.name,
    daneCode: c.daneCode,
    departmentId: departmentIds.get(c.department)!
  })).filter(c => !knownCities.has(cityKey(c.departmentId, c.name)));
  await db.city.createMany({ data: newCities });
  reportCreated('Ciudades de Colombia', newCities.length, CITIES.length);
}
