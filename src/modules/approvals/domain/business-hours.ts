// Horas hábiles colombianas (Ley 1186/1983 "Ley Emiliani"). Dominio puro: recibe la fecha, no lee el reloj.
//
// Horas hábiles: lunes a viernes de 00:00 a 23:59, excluyendo festivos.
// Festivos colombianos = fijos (siempre misma fecha) + flotantes (siguiente lunes si caen
// en martes-domingo, según Ley Emiliani).
//
// [VERIFICAR-NORMATIVA]: validar lista completa con funcionpublica.gov.co o
// secretariasenado.gov.co antes de activar en producción. La tabla cubre 2024-2030.
// Para agregar un año nuevo: añadir una entrada en FIXED_HOLIDAYS_BY_YEAR (con los
// festivos flotantes ya calculados) y extender EMILIANI_FLOATING_RULES si aplica.
//
// Uso:
//   import { addBusinessHours } from './business-hours';
//   const due = addBusinessHours(new Date(), 48); // +48 horas hábiles desde ahora

// ─── Festivos FIJOS por año (no aplica Ley Emiliani — siempre caen en la misma fecha) ─────
// Año Nuevo, Día del Trabajo, Día de la Independencia, Batalla de Boyacá,
// Inmaculada Concepción, Navidad.

const FIXED_HOLIDAYS = [
  { month: 1, day: 1 }, // Año Nuevo
  { month: 5, day: 1 }, // Día del Trabajo
  { month: 7, day: 20 }, // Día de la Independencia
  { month: 8, day: 7 }, // Batalla de Boyacá
  { month: 12, day: 8 }, // Inmaculada Concepción
  { month: 12, day: 25 } // Navidad
];

// ─── Festivos FLOTANTES pre-calculados por año ─────────────────────────────────────────────
// Los festivos flotantes se mueven al lunes siguiente si caen en martes-domingo.
// Se pre-calculan por año para evitar lógica compleja en runtime.
// [VERIFICAR-NORMATIVA]: confirmar con fuente oficial antes de usar en producción.
//
// Festivos flotantes (Ley Emiliani):
//   - Reyes Magos (6 enero → lunes)
//   - San José (19 marzo → lunes)
//   - Jueves Santo (móvil — Semana Santa)
//   - Viernes Santo (móvil — Semana Santa)
//   - Ascensión del Señor (39 días tras Pascua → lunes)
//   - Corpus Christi (60 días tras Pascua → lunes)
//   - Sagrado Corazón (68 días tras Pascua → lunes)
//   - San Pedro y San Pablo (29 junio → lunes)
//   - Asunción de la Virgen (15 agosto → lunes)
//   - Día de la Raza (12 octubre → lunes)
//   - Todos los Santos (1 noviembre → lunes)
//   - Independencia de Cartagena (11 noviembre → lunes)

const FLOATING_HOLIDAYS_BY_YEAR: Record<number, string[]> = {
  2024: [
    '2024-01-08', // Reyes Magos
    '2024-03-25', // San José
    '2024-03-28', // Jueves Santo
    '2024-03-29', // Viernes Santo
    '2024-05-13', // Ascensión del Señor
    '2024-06-03', // Corpus Christi
    '2024-06-10', // Sagrado Corazón
    '2024-07-01', // San Pedro y San Pablo
    '2024-08-19', // Asunción de la Virgen
    '2024-10-14', // Día de la Raza
    '2024-11-04', // Todos los Santos
    '2024-11-11' // Independencia de Cartagena
  ],
  2025: [
    '2025-01-06', // Reyes Magos
    '2025-03-24', // San José
    '2025-04-17', // Jueves Santo
    '2025-04-18', // Viernes Santo
    '2025-06-02', // Ascensión del Señor
    '2025-06-23', // Corpus Christi
    '2025-06-30', // Sagrado Corazón
    '2025-06-30', // San Pedro y San Pablo (coincide)
    '2025-08-18', // Asunción de la Virgen
    '2025-10-13', // Día de la Raza
    '2025-11-03', // Todos los Santos
    '2025-11-17' // Independencia de Cartagena
  ],
  2026: [
    '2026-01-12', // Reyes Magos
    '2026-03-23', // San José
    '2026-04-02', // Jueves Santo
    '2026-04-03', // Viernes Santo
    '2026-05-18', // Ascensión del Señor
    '2026-06-08', // Corpus Christi
    '2026-06-15', // Sagrado Corazón
    '2026-06-29', // San Pedro y San Pablo
    '2026-08-17', // Asunción de la Virgen
    '2026-10-12', // Día de la Raza
    '2026-11-02', // Todos los Santos
    '2026-11-16' // Independencia de Cartagena
  ],
  2027: [
    '2027-01-11', // Reyes Magos
    '2027-03-22', // San José
    '2027-03-25', // Jueves Santo
    '2027-03-26', // Viernes Santo
    '2027-05-10', // Ascensión del Señor
    '2027-05-31', // Corpus Christi
    '2027-06-07', // Sagrado Corazón
    '2027-07-05', // San Pedro y San Pablo
    '2027-08-16', // Asunción de la Virgen
    '2027-10-18', // Día de la Raza
    '2027-11-01', // Todos los Santos
    '2027-11-15' // Independencia de Cartagena
  ],
  2028: [
    '2028-01-10', // Reyes Magos
    '2028-03-20', // San José
    '2028-04-13', // Jueves Santo
    '2028-04-14', // Viernes Santo
    '2028-05-29', // Ascensión del Señor
    '2028-06-19', // Corpus Christi
    '2028-06-26', // Sagrado Corazón
    '2028-07-03', // San Pedro y San Pablo
    '2028-08-21', // Asunción de la Virgen
    '2028-10-16', // Día de la Raza
    '2028-11-06', // Todos los Santos
    '2028-11-13' // Independencia de Cartagena
  ],
  2029: [
    '2029-01-08', // Reyes Magos
    '2029-03-19', // San José
    '2029-04-05', // Jueves Santo (móvil)
    '2029-04-06', // Viernes Santo
    '2029-05-21', // Ascensión del Señor
    '2029-06-11', // Corpus Christi
    '2029-06-18', // Sagrado Corazón
    '2029-07-02', // San Pedro y San Pablo
    '2029-08-20', // Asunción de la Virgen
    '2029-10-15', // Día de la Raza
    '2029-11-05', // Todos los Santos
    '2029-11-12' // Independencia de Cartagena
  ],
  2030: [
    '2030-01-07', // Reyes Magos
    '2030-03-25', // San José
    '2030-04-18', // Jueves Santo
    '2030-04-19', // Viernes Santo
    '2030-06-03', // Ascensión del Señor
    '2030-06-24', // Corpus Christi
    '2030-07-01', // Sagrado Corazón
    '2030-07-01', // San Pedro y San Pablo (coincide)
    '2030-08-19', // Asunción de la Virgen
    '2030-10-14', // Día de la Raza
    '2030-11-04', // Todos los Santos
    '2030-11-11' // Independencia de Cartagena
  ]
};

// ─── Constantes de día de la semana (getDay() devuelve 0-6) ──────────────────────────────

const SUNDAY = 0;
const SATURDAY = 6;

// ─── Cache de festivos por año (Set de strings 'YYYY-MM-DD') ──────────────────────────────

const _cache: Record<number, Set<string>> = {};

function _buildHolidaySet(year: number): Set<string> {
  const cached = _cache[year];
  if (cached) {
    return cached;
  }

  const set = new Set<string>();

  for (const { month, day } of FIXED_HOLIDAYS) {
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    set.add(`${year}-${mm}-${dd}`);
  }

  const floating = FLOATING_HOLIDAYS_BY_YEAR[year] ?? [];
  for (const d of floating) {
    set.add(d);
  }

  _cache[year] = set;
  return set;
}

function _toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Determina si una fecha es día hábil colombiano (lunes–viernes y no festivo).
 *
 * @param {Date} date
 * @returns {boolean}
 */
export function isBusinessDay(date: Date): boolean {
  const dow = date.getDay(); // 0=dom, 6=sáb
  if (dow === SUNDAY || dow === SATURDAY) {
    return false;
  }
  const year = date.getFullYear();
  const holidays = _buildHolidaySet(year);
  return !holidays.has(_toDateKey(date));
}

/**
 * Agrega `hours` horas hábiles a `startDate`.
 *
 * El conteo avanza hora a hora; cada hora que cae en un día hábil se cuenta.
 * Días no hábiles (sábado, domingo, festivo) se saltan completamente.
 *
 * Complejidad: O(hours * 24) en el peor caso (festivos consecutivos).
 * Para los valores esperados (max 120h) esto es << 1ms.
 *
 * @param {Date} startDate  — fecha/hora de inicio
 * @param {number} hours    — horas hábiles a sumar (entero positivo)
 * @returns {Date}
 */
export function addBusinessHours(startDate: Date, hours: number): Date {
  const MS_PER_HOUR = 3600000;
  let current = new Date(startDate.getTime());
  let remaining = Math.max(0, Math.round(hours));

  while (remaining > 0) {
    current = new Date(current.getTime() + MS_PER_HOUR);
    if (isBusinessDay(current)) {
      remaining--;
    }
  }

  return current;
}

