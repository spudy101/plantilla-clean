// CAMBIO 6 — Clasificación canónica de códigos de error del AWS SDK v3 para reintentos.
//
// El worker de reintentos de notificaciones lee el código del proveedor (error.name del SDK, vía
// awsErrorCode) que el envío guardó en la notificación (email_error_code / push_error_code) y decide:
//   - hard bounce → NO reintentar, cerrar (markEmail/PushPermanentFailure)
//   - temporal / desconocido → reintentar normalmente (default seguro: ante duda, reintenta)
//
// Decisión binaria por código: si está en la lista HARD del canal → cerrar; el resto reintenta.
// Las listas TEMPORAL son documentativas (no se consultan para decidir, pero fijan el criterio).

// SES (email). InvalidParameterValue/MessageRejected = destino/payload inaceptable de forma
// permanente. AccountSendingPausedException = envío pausado a nivel cuenta (no se resuelve solo).
const EMAIL_HARD_BOUNCE_CODES = ['MessageRejected', 'InvalidParameterValue', 'AccountSendingPausedException'];

// SNS (push). EndpointDisabled = token de dispositivo dado de baja por el provider (APNs/FCM);
// InvalidParameter = ARN/payload inválido. Permanentes: reenviar al mismo endpoint nunca funcionará.
const PUSH_HARD_BOUNCE_CODES = ['EndpointDisabled', 'InvalidParameter'];

// Transitorios: se resuelven solos con reintento (documentativo).
const TEMPORAL_CODES = ['Throttling', 'ThrottlingException', 'ServiceUnavailable', 'InternalServerError', 'InternalFailure'];

// ¿El código indica un fallo permanente (hard bounce) para el canal dado?
function isHardBounce(channel: 'email' | 'push' | string, code: string | number | null | undefined): boolean {
  if (!code) {
    return false;
  }
  const list = channel === 'push' ? PUSH_HARD_BOUNCE_CODES : EMAIL_HARD_BOUNCE_CODES;
  return list.includes(String(code));
}

// El dispositivo ya no existe para el proveedor (app desinstalada, token vencido): su token se desactiva.
function isEndpointDisabled(code: string | number | null | undefined): boolean {
  return code === 'EndpointDisabled';
}

export default {
  EMAIL_HARD_BOUNCE_CODES,
  PUSH_HARD_BOUNCE_CODES,
  TEMPORAL_CODES,
  isHardBounce,
  isEndpointDisabled
};
