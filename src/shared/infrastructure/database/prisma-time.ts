// shared/database/prisma-time.ts
//
// Columnas `TIME` (horario de no molestar). Sequelize las devolvía como texto 'HH:MM:SS' y así las
// usan los services (comparación de horas) y la API. Prisma las mapea a `Date` (1970-01-01, hora en
// UTC), así que los repositorios convierten en el borde y hacia afuera siguen siendo texto.

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
/** Posición de 'HH:MM:SS' dentro de un ISO 8601 ('1970-01-01THH:MM:SS.sssZ'). */
const ISO_TIME = { start: 11, end: 19 } as const;

/** 'HH:MM' / 'HH:MM:SS' → Date para una columna TIME; null/'' → null. Lanza si el formato no es válido. */
export function toTime(value: string | null | undefined): Date | null {
  if (value == null || value === '') {
    return null;
  }
  const match = TIME_RE.exec(value);
  if (!match) {
    throw new TypeError(`Hora inválida: "${value}" (se espera HH:MM o HH:MM:SS)`);
  }
  const [, h, m, s = '00'] = match;
  return new Date(`1970-01-01T${h!.padStart(2, '0')}:${m}:${s}Z`);
}

/** Date de una columna TIME → 'HH:MM:SS' (el formato que devolvía Sequelize); null → null. */
export function fromTime(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(ISO_TIME.start, ISO_TIME.end) : null;
}

export default { toTime, fromTime };
