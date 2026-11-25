// Preferencia de notificación del usuario: una sola por usuario (canales permitidos + horario de silencio).
// Si nunca la configuró, todo está permitido y no hay horario de silencio. Las categorías críticas la ignoran.
//
// El horario es texto 'HH:MM:SS' en la hora del servidor; un rango puede cruzar medianoche (22:00 → 07:00).
import type { Channel } from './notification-type';

export interface NotificationPreference {
  userNotificationPreferenceId: string;
  userId: string;
  allowPush: boolean | null;
  allowEmail: boolean | null;
  allowSms: boolean | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  originSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Lo que decide el envío: canales permitidos y horario. null/undefined → todo permitido. */
export type DeliveryPreference =
  | (Partial<Pick<NotificationPreference, 'allowPush' | 'allowEmail' | 'allowSms'>> & {
      quietHoursStart?: string | null;
      quietHoursEnd?: string | null;
    })
  | null
  | undefined;

export const PREFERENCE_FIELDS = ['allowPush', 'allowEmail', 'allowSms', 'quietHoursStart', 'quietHoursEnd'] as const;

/** Cambios pedidos; undefined = no se toca. */
export type PreferenceChanges = Partial<{
  allowPush: boolean;
  allowEmail: boolean;
  allowSms: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}>;

/** Solo los campos de preferencia presentes en la entrada. */
export function preferenceChanges(input: PreferenceChanges): PreferenceChanges {
  return Object.fromEntries(PREFERENCE_FIELDS.filter(key => input[key] !== undefined).map(key => [key, input[key]])) as PreferenceChanges;
}

const allowKey = { push: 'allowPush', email: 'allowEmail', sms: 'allowSms' } as const;

/** ¿El usuario permite el canal? Sin preferencia (o sin el dato), sí. */
export const allowsChannel = (preference: DeliveryPreference, channel: Channel): boolean =>
  preference?.[allowKey[channel]] ?? true;

const pad = (n: number) => n.toString().padStart(2, '0');

/** ¿`now` cae dentro del horario de silencio? */
export function isInQuietHours(preference: DeliveryPreference, now = new Date()): boolean {
  const start = preference?.quietHoursStart;
  const end = preference?.quietHoursEnd;
  if (!start || !end) {
    return false;
  }
  const current = `${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/** Próxima vez que termina el horario de silencio (hoy o mañana). */
export function endOfQuietHours(preference: DeliveryPreference, now = new Date()): Date {
  const [hours = '0', minutes = '0'] = (preference?.quietHoursEnd ?? '00:00').split(':');
  const end = new Date(now);
  end.setHours(Number.parseInt(hours, 10), Number.parseInt(minutes, 10), 0, 0);
  if (end <= now) {
    end.setDate(end.getDate() + 1);
  }
  return end;
}
