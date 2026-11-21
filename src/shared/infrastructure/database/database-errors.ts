// Clasifica los errores de la base que NO son culpa de la petición, para responder lo correcto:
//
//   unavailable           → la base no está o no da abasto (caída, sin conexiones, timeout).
//                           503 DATABASE_UNAVAILABLE, temporal.
//   transaction-conflict  → deadlock o error de serialización: otra transacción tocó lo mismo.
//                           El Unit of Work repite la transacción; si sigue, 409 TRANSACTION_CONFLICT temporal.
//
// El resto (restricciones UNIQUE/FK, fila inexistente, errores de SQL) son de la petición o bugs: los
// traduce el middleware de errores a 4xx/500.
//
// Los errores llegan por tres caminos y se miran los tres:
//   - Prisma traduce lo que reconoce a un código (P1001, P2034…): `code` o `errorCode` (al conectar).
//   - El adaptador de Postgres deja la causa en `meta.driverAdapterError.cause`: `kind` y, si viene de
//     Postgres, su SQLSTATE en `originalCode`.
//   - Lo que el adaptador no reconoce llega tal cual: el timeout del pool de `pg` como Error con su mensaje,
//     y un error de red como código de Node en `code` (visto contra Postgres real: un puerto cerrado llega
//     como PrismaClientKnownRequestError con code 'ECONNREFUSED', no P1001, porque Node lo emite como
//     AggregateError IPv4/IPv6 sin `syscall` y el adaptador no lo traduce). tests/integration/database-errors.

// Códigos de Prisma (docs: prisma.io/docs/orm/reference/error-reference).
const UNAVAILABLE_PRISMA_CODES = new Set([
  'P1001', // no se puede alcanzar el servidor
  'P1002', // el servidor no respondió a tiempo
  'P1008', // timeout de la operación
  'P1017', // el servidor cerró la conexión
  'P2024', // timeout esperando una conexión del pool
  'P2028', // la transacción venció (timeout) o se cerró
  'P2037' // demasiadas conexiones abiertas
]);
const CONFLICT_PRISMA_CODES = new Set(['P2034']); // write conflict o deadlock

// SQLSTATE de Postgres (postgresql.org/docs/current/errcodes-appendix.html).
const UNAVAILABLE_SQLSTATES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (arrancando)
  '53300', // too_many_connections
  '57014' // query_canceled (statement_timeout)
]);
const CONFLICT_SQLSTATES = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected

// Códigos de red de Node (errno): la conexión con la base no se pudo abrir o se cortó.
const UNAVAILABLE_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'EAI_AGAIN'
]);

const UNAVAILABLE_KINDS = new Set([
  'DatabaseNotReachable',
  'ConnectionClosed',
  'SocketTimeout',
  'TooManyConnections',
  'TlsConnectionError'
]);

// Errores de `pg` / `pg-pool` sin traducir (el adaptador los relanza tal cual).
const UNAVAILABLE_MESSAGES = /timeout exceeded when trying to connect|Connection terminated/i;

type DatabaseErrorKind = 'unavailable' | 'transaction-conflict';

interface ErrorShape {
  name?: string;
  code?: unknown;
  errorCode?: unknown;
  message?: unknown;
  cause?: unknown;
  meta?: { driverAdapterError?: { cause?: { kind?: string; originalCode?: string } } };
}

function classify(error: unknown, depth = 0): DatabaseErrorKind | null {
  if (!error || typeof error !== 'object' || depth > 3) {
    return null;
  }
  const e = error as ErrorShape;
  const prismaCode = typeof e.code === 'string' ? e.code : typeof e.errorCode === 'string' ? e.errorCode : null;
  const cause = e.meta?.driverAdapterError?.cause;

  if (
    (prismaCode && CONFLICT_PRISMA_CODES.has(prismaCode)) ||
    (cause?.originalCode && CONFLICT_SQLSTATES.has(cause.originalCode))
  ) {
    return 'transaction-conflict';
  }
  if (
    (prismaCode && UNAVAILABLE_PRISMA_CODES.has(prismaCode)) ||
    (prismaCode && UNAVAILABLE_SQLSTATES.has(prismaCode)) ||
    (prismaCode && UNAVAILABLE_NETWORK_CODES.has(prismaCode)) ||
    (cause?.kind && UNAVAILABLE_KINDS.has(cause.kind)) ||
    (cause?.originalCode && UNAVAILABLE_SQLSTATES.has(cause.originalCode)) ||
    e.name === 'PrismaClientInitializationError' ||
    (typeof e.message === 'string' && UNAVAILABLE_MESSAGES.test(e.message))
  ) {
    return 'unavailable';
  }
  return classify(e.cause, depth + 1);
}

/** La base no está disponible o no da abasto: temporal, no es culpa de la petición. */
function isDatabaseUnavailable(error: unknown): boolean {
  return classify(error) === 'unavailable';
}

/** Deadlock o error de serialización: repetir la transacción completa puede funcionar. */
function isTransactionConflict(error: unknown): boolean {
  return classify(error) === 'transaction-conflict';
}

export { isDatabaseUnavailable, isTransactionConflict };
export default { isDatabaseUnavailable, isTransactionConflict };
