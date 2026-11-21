// El mapper es la frontera con la base: copia campo a campo (lista blanca) y solo lleva las relaciones
// que vinieron en la consulta.
import { CatalogMapper, mapOrNull } from './catalog.mapper';

const at = new Date('2026-01-01T00:00:00Z');
const status = { isActive: true, createdAt: at, updatedAt: at };

describe('CatalogMapper', () => {
  it('una columna que no es del dominio no pasa a la entrada', () => {
    const row = { genderId: 'g1', name: 'Femenino', ...status, internalNote: 'no debe salir' };
    expect(CatalogMapper.gender(row)).toEqual({ genderId: 'g1', name: 'Femenino', ...status });
  });

  it('la relación sale solo si la consulta la trajo', () => {
    const base = { departmentId: 'd1', name: 'Antioquia', daneCode: '05', countryId: 'co', ...status };
    expect(CatalogMapper.department(base)).not.toHaveProperty('country');
    expect(CatalogMapper.department({ ...base, country: { countryId: 'co', name: 'Colombia', code: 'COL' } }).country).toEqual({
      countryId: 'co',
      name: 'Colombia',
      code: 'COL'
    });
  });

  it('ciudad con departamento y país anidados', () => {
    const city = CatalogMapper.city({
      cityId: 'c1',
      name: 'Medellín',
      daneCode: '001',
      departmentId: 'd1',
      ...status,
      department: { departmentId: 'd1', name: 'Antioquia', country: { countryId: 'co', name: 'Colombia', code: 'COL' } }
    });
    expect(city.department?.country?.code).toBe('COL');
  });

  it('mapOrNull respeta el null del repositorio', () => {
    expect(mapOrNull(null, CatalogMapper.gender)).toBeNull();
  });
});
