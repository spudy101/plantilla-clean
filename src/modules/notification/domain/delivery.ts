// Entregas de una notificación personal por canal externo (push, email, sms): una por canal que aplica.
//
// Ciclo: pending → sent | failed | skipped. Mientras está pending, nextAttemptAt dice cuándo toca el próximo
// intento. Un error se reintenta con espera creciente; un rebote definitivo o el último intento la cierran como
// fallida. Entrega "al menos una vez": si el proceso muere entre que el proveedor acepta y se marca `sent`, ese
// envío se repite al vencer la reserva.
import { CHANNELS, categorySupports, isCritical, type CategoryRules, type Channel } from './notification-type';
import { allowsChannel, endOfQuietHours, isInQuietHours, type DeliveryPreference } from './notification-preference';

const MINUTE_MS = 60 * 1000;

/** Espera antes de cada reintento: tras el 1er fallo 1 min, tras el 2º 5 min... Después del último, fallida. */
// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- la tabla de esperas (en minutos) es la regla
export const RETRY_DELAYS_MS = [1, 5, 30, 120, 360].map(minutes => minutes * MINUTE_MS);
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** Reserva de un intento en curso: si el proceso muere, la entrega vuelve a estar vencida al terminar. */
const LEASE_MINUTES = 5;
export const DELIVERY_LEASE_MS = LEASE_MINUTES * MINUTE_MS;

/** Un SMS lleva el cuerpo de la notificación, cortado a este largo. */
export const SMS_MAX_LENGTH = 160;

export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped';

/** Lo que el despachador necesita de una entrega tomada. */
export interface ClaimedDelivery {
  notificationDeliveryId: string;
  notificationId: string;
  channel: Channel;
  attempts: number;
}

/** Resultado de un intento por un canal. */
export type DeliveryOutcome =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; error: string; errorCode: string | null; permanent: boolean };

/** Acción de auditoría cuando una entrega queda fallida para siempre. */
export const FAILED_DELIVERY_AUDIT_ACTION = {
  push: 'PUSH_DELIVERY_FAILED',
  email: 'EMAIL_DELIVERY_FAILED',
  sms: 'SMS_DELIVERY_FAILED'
} as const satisfies Record<Channel, string>;

/** Canales por los que sale: los que soporta la categoría y, salvo categoría crítica, permite el usuario. */
export function channelsFor(category: CategoryRules | null | undefined, preference: DeliveryPreference): Channel[] {
  const critical = isCritical(category);
  return CHANNELS.filter(channel => categorySupports(category, channel) && (critical || allowsChannel(preference, channel)));
}

export interface DeliveryPlan {
  channels: Channel[];
  /** Fin del horario de silencio, si el envío queda diferido. */
  deferUntil: Date | null;
  /** true: quien crea la notificación las envía apenas confirma (quedan reservadas hasta entonces). */
  sendNow: boolean;
  firstAttemptAt: Date;
}

/**
 * Cuándo salen las entregas de una notificación nueva. En horario de silencio (categoría no crítica) quedan
 * para el final del horario. Si no, y se puede enviar ya, quedan reservadas para que quien crea la notificación
 * las envíe tras confirmar; si no se puede, las toma el próximo ciclo del despachador.
 */
export function planDeliveries(
  category: CategoryRules | null | undefined,
  preference: DeliveryPreference,
  { canSendNow, now = new Date() }: { canSendNow: boolean; now?: Date }
): DeliveryPlan {
  const channels = channelsFor(category, preference);
  const deferUntil = !isCritical(category) && isInQuietHours(preference, now) ? endOfQuietHours(preference, now) : null;
  const sendNow = channels.length > 0 && deferUntil === null && canSendNow;
  const firstAttemptAt = deferUntil ?? (sendNow ? new Date(now.getTime() + DELIVERY_LEASE_MS) : now);
  return { channels, deferUntil, sendNow, firstAttemptAt };
}

/** Tras un intento fallido: null si queda fallida para siempre, o cuándo se reintenta. */
export function nextAttemptAfterFailure(attemptNumber: number, permanent: boolean, now = Date.now()): Date | null {
  if (permanent || attemptNumber >= MAX_ATTEMPTS) {
    return null;
  }
  return new Date(now + RETRY_DELAYS_MS[attemptNumber - 1]!);
}

/** Las entregas tomadas, agrupadas por notificación (una lectura de la notificación por grupo). */
export function groupByNotification(claimed: readonly ClaimedDelivery[]): Map<string, ClaimedDelivery[]> {
  const byNotification = new Map<string, ClaimedDelivery[]>();
  for (const delivery of claimed) {
    byNotification.set(delivery.notificationId, [...(byNotification.get(delivery.notificationId) ?? []), delivery]);
  }
  return byNotification;
}

/** Una entrega como la consulta soporte ("¿le llegó?"), con lo justo de su notificación. */
export interface DeliveryRecord {
  notificationDeliveryId: string;
  notificationId: string;
  channel: Channel;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  lastError: string | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  notification: {
    notificationId: string;
    userId: string;
    title: string;
    body: string;
    metadata: unknown;
    relatedEntityType: string | null;
    relatedEntityId: string | null;
    createdAt: Date;
    notificationType: { code: string; name: string; category: { code: string; name: string; isCritical: boolean } | null } | null;
  };
}
