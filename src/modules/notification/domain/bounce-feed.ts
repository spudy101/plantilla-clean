// El feed asíncrono de rebotes de SES, que llega por SNS: SES publica los rebotes (Configuration Set → topic
// SNS) y SNS hace POST al webhook. Solo los rebotes PERMANENTES suman al umbral de supresión; los transitorios
// (soft) y las quejas (complaint) se ignoran.
import { MalformedFeedError } from './errors';

/** El envelope de SNS (la firma se verifica aparte; hasta entonces la forma es la que dice el propio mensaje). */
export interface FeedMessage {
  Type?: string;
  TopicArn?: string;
  Message?: string;
  [key: string]: unknown;
}

export function parseFeedEnvelope(rawBody: string | Record<string, unknown> | null | undefined): FeedMessage {
  if (rawBody && typeof rawBody === 'object') {
    return rawBody as FeedMessage;
  }
  try {
    return JSON.parse(rawBody ?? '') as FeedMessage;
  } catch {
    throw new MalformedFeedError('Cuerpo del webhook no es JSON válido');
  }
}

/** SNS pide confirmar (o confirma) la suscripción del webhook al topic. */
export const isSubscriptionHandshake = (message: FeedMessage): boolean =>
  message.Type === 'SubscriptionConfirmation' || message.Type === 'UnsubscribeConfirmation';

export interface SesBounce {
  bounceType?: string;
  bounceSubType?: string;
  feedbackId?: string;
  bouncedRecipients?: Array<{ emailAddress?: string } | null>;
}

export type FeedEvent =
  | { kind: 'permanent_bounce'; recipients: string[]; recipientCount: number; errorCode: string; feedbackId: string | null }
  | { kind: 'ignored'; eventKind: unknown; bounceType: string | null };

/** Qué dice una Notification de SNS: un rebote permanente (con sus destinatarios) o algo que se ignora. */
export function readFeedEvent(message: FeedMessage): FeedEvent {
  let ses: { notificationType?: unknown; eventType?: unknown; bounce?: SesBounce };
  try {
    ses = JSON.parse(message.Message ?? '');
  } catch {
    throw new MalformedFeedError('El campo Message de SNS no es JSON válido');
  }
  // El formato de feedback forwarding usa notificationType; el de event publishing, eventType.
  const kind = ses.notificationType || ses.eventType;
  const { bounce } = ses;
  if (kind !== 'Bounce' || !bounce || bounce.bounceType !== 'Permanent') {
    return { kind: 'ignored', eventKind: kind, bounceType: bounce?.bounceType || null };
  }
  const listed = Array.isArray(bounce.bouncedRecipients) ? bounce.bouncedRecipients : [];
  return {
    kind: 'permanent_bounce',
    recipients: listed.flatMap(r => (r?.emailAddress ? [r.emailAddress] : [])),
    recipientCount: listed.length,
    errorCode: bounce.bounceSubType || 'Permanent',
    feedbackId: bounce.feedbackId || null
  };
}
