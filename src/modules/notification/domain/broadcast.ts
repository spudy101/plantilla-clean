// Envío masivo de una notificación global (push + email a todos los clientes activos).
//
// Va por páginas de usuarios ordenadas por user_id. Después de cada página se guarda el último user_id enviado
// (cursor), se suman los enviados y se renueva la reserva: si el proceso muere, la reserva vence y el
// despachador lo retoma desde el cursor. Como las entregas individuales, es "al menos una vez": la página en
// curso al morir se reenvía.

const MINUTE_MS = 60 * 1000;

/** Usuarios por página (y por avance guardado). */
export const BROADCAST_PAGE_SIZE = 100;
/** Tokens por llamada masiva a push y emails por tanda: lo que descuenta el tope por minuto de cada proveedor. */
export const PUSH_CHUNK = 100;
export const EMAIL_CHUNK = 50;
/** Reserva del envío en curso; se renueva en cada página. */
const LEASE_MINUTES = 5;
export const BROADCAST_LEASE_MS = LEASE_MINUTES * MINUTE_MS;

/** Un cliente de la página: a quién mandarle (el email puede faltar). */
export interface BroadcastRecipient {
  userId: string;
  email: string | null;
}

export const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

