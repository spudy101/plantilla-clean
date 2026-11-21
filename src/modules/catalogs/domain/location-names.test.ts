// Reglas para reconocer ciudades y prefijos de un tercero: funciones puras, sin base de datos.
import { cleanCityName, matchCityByName, normalizeName, normalizePhonePrefix } from './location-names';

const cities = [
  { cityId: 'c1', name: 'Bogotá' },
  { cityId: 'c2', name: 'Pácora' },
  { cityId: 'c3', name: 'San José' }
];

describe('normalizeName / cleanCityName', () => {
  it('quita acentos, pasa a mayúsculas y colapsa espacios', () => {
    expect(normalizeName('  san   José ')).toBe('SAN JOSE');
  });

  it('descarta lo que viene entre paréntesis', () => {
    expect(cleanCityName('BOGOTA ( BOGOTA DISTRITO CA ) ')).toBe('BOGOTA');
  });
});

describe('matchCityByName', () => {
  it('coincidencia exacta sin acentos ni mayúsculas', () => {
    expect(matchCityByName(cities, 'BOGOTA ( BOGOTA DISTRITO CA ) ')?.cityId).toBe('c1');
    expect(matchCityByName(cities, 'pacora')?.cityId).toBe('c2');
  });

  it('si no hay exacta, la ciudad que aparece como palabra completa', () => {
    expect(matchCityByName(cities, 'SAN JOSE DEL GUAVIARE')?.cityId).toBe('c3');
  });

  it('no confunde una ciudad con parte de una palabra', () => {
    expect(matchCityByName([{ cityId: 'c4', name: 'Une' }], 'FUNES')).toBeNull();
  });

  it('nombre vacío → null', () => {
    expect(matchCityByName(cities, ' ( ) ')).toBeNull();
  });
});

describe('normalizePhonePrefix', () => {
  it.each([
    ['57', '+57'],
    ['+57', '+57'],
    [' 5 7 ', '+57'],
    ['', null],
    ['abc', null]
  ])('%p → %p', (raw, expected) => {
    expect(normalizePhonePrefix(raw)).toBe(expected);
  });
});
