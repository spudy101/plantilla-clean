// Retención de la auditoría [RF-AUTH-01 CA-07, RF-ADM-03]: los registros quedan en la base (caliente) los
// años configurados — 5 por defecto (Circular ADC-2007 SFC) — y su copia fría vive en S3, un archivo por día.
// La purga de la base es destructiva: solo corre si el Superadministrador la activó en la configuración.

export const DEFAULT_HOT_YEARS = 5;
const MS_PER_DAY = 86_400_000;

export interface RetentionSettings {
  /** null si no hay configuración: se usa DEFAULT_HOT_YEARS. */
  hotYears: number | null;
  hotPurgeEnabled: boolean;
}

export function hotYearsOf(settings: RetentionSettings | null): number {
  return settings?.hotYears ?? DEFAULT_HOT_YEARS;
}

/** Hasta cuándo (inclusive) un registro vence en el próximo año: el aviso al Superadmin. */
export function expiringCutoff(now: Date, hotYears: number): Date {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - hotYears + 1);
  return cutoff;
}

/** Los registros creados antes de este instante superaron el período caliente. */
export function purgeCutoff(now: Date, hotYears: number): Date {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - hotYears);
  return cutoff;
}

/** El día UTC completo que contiene `day`: [from, to). */
export function utcDayOf(day: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  return { from, to: new Date(from.getTime() + MS_PER_DAY) };
}

/** Dónde vive la copia fría de un día: audit-logs/AAAA/MM/DD.jsonl. */
export function archiveKeyOf(dayStart: Date): string {
  const [yyyy, mm, dd] = dayStart.toISOString().slice(0, 10).split('-');
  return `audit-logs/${yyyy}/${mm}/${dd}.jsonl`;
}

/** Hace cuántos días: el corte de la retención de los datos técnicos. */
export function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MS_PER_DAY);
}
