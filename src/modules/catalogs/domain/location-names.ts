// Reglas para reconocer una ciudad o un prefijo telefónico a partir del texto que manda un tercero (p. ej.
// un bureau de crédito: 'BOGOTA ( BOGOTA DISTRITO CA ) ', '57').
//
// Son reglas del dominio, no de la base: por eso viven acá, son funciones puras y se prueban sin Postgres.
// El repositorio solo trae las ciudades activas; decidir cuál coincide es esto.

const DIACRITICS = /[̀-ͯ]/g;

/** Sin acentos, en mayúsculas y con un solo espacio entre palabras. */
export function normalizeName(value: string): string {
  return value.normalize('NFD').replace(DIACRITICS, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** El nombre de la ciudad sin lo que venga entre paréntesis. */
export function cleanCityName(value: string): string {
  return normalizeName(value.split('(')[0] ?? '');
}

/**
 * La ciudad que corresponde a `rawName`: primero por nombre exacto (normalizado) y, si no hay, la primera
 * cuyo nombre aparece como palabra completa dentro de `rawName`. null si no hay ninguna.
 */
export function matchCityByName<C extends { name: string }>(cities: readonly C[], rawName: string): C | null {
  const target = cleanCityName(rawName);
  if (!target) {
    return null;
  }
  const exact = cities.find(city => normalizeName(city.name) === target);
  if (exact) {
    return exact;
  }
  return (
    cities.find(city => {
      const name = normalizeName(city.name);
      return name !== '' && ` ${target} `.includes(` ${name} `);
    }) ?? null
  );
}

/** '57', '+57', ' 57 ' → '+57' (como se guarda). null si no trae dígitos. */
export function normalizePhonePrefix(rawPrefix: string): string | null {
  const digits = rawPrefix.replace(/\D/g, '');
  return digits ? `+${digits}` : null;
}
