// Códigos de los rechazos de autenticación (401) y de dispositivo bloqueado (403): el contrato con el front.
//
// [RF-AUTH-02] | CA-01/CA-02 | Todos los 401 salen con `code: 'UNAUTHORIZED'` y mensajes en prosa, así
// que el front no puede distinguir "el access token venció, renová y reintentá" de "la sesión murió,
// mandá a login" — y ante la duda desloguea, que es justo el síntoma reportado. Estos códigos viajan
// en `details.code` (mismo patrón que MFA_REQUIRED) y son el contrato con el front:
//
//   TOKEN_EXPIRED  → renovar con /auth/refresh y reintentar el request.
//   cualquier otro → desloguear y mandar a login.
//
// Son reglas del negocio de autenticación (no configuración): los usan el dominio de iam y la verificación de
// tokens de shared/infrastructure.
const AUTH_ERROR_CODES = {
  TOKEN_EXPIRED: 'TOKEN_EXPIRED', // access token vencido — recuperable con refresh
  TOKEN_INVALID: 'TOKEN_INVALID', // firma inválida / malformado
  SESSION_CLOSED: 'SESSION_CLOSED', // logout, logout-all, revocación admin, rotación
  SESSION_INACTIVITY: 'SESSION_INACTIVITY', // 15 min sin pegarle a ninguna API
  SESSION_ABSOLUTE_LIFETIME: 'SESSION_ABSOLUTE_LIFETIME', // tope de 8h desde started_at
  SESSION_COMPROMISED: 'SESSION_COMPROMISED', // reuse attack — todas las sesiones cerradas
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID', // refresh vencido, revocado o ausente
  DEVICE_BLOCKED: 'DEVICE_BLOCKED' // dispositivo en blocklist (403)
} as const;

export default AUTH_ERROR_CODES;
