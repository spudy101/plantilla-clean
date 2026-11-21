// Horario de silencio del usuario ('HH:MM:SS', hora del servidor). Si cae dentro, el envío por canal
// externo se difiere al final del horario; la notificación in-app se crea igual.
import type * as Types from '../notification.types';

type Preference = Types.UserPreference;

const pad = (n: number) => n.toString().padStart(2, '0');

/** ¿`now` cae dentro del horario de silencio? Soporta rangos que cruzan medianoche (22:00 → 07:00). */
export function isInQuietHours(preference: Preference, now = new Date()): boolean {
  const start = preference?.quietHoursStart;
  const end = preference?.quietHoursEnd;
  if (!start || !end) {
    return false;
  }
  const current = `${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/** Próxima vez que termina el horario de silencio (hoy o mañana). */
export function endOfQuietHours(preference: Preference, now = new Date()): Date {
  const [hours = '0', minutes = '0'] = (preference?.quietHoursEnd ?? '00:00').split(':');
  const end = new Date(now);
  end.setHours(Number.parseInt(hours, 10), Number.parseInt(minutes, 10), 0, 0);
  if (end <= now) {
    end.setDate(end.getDate() + 1);
  }
  return end;
}

export default { isInQuietHours, endOfQuietHours };
