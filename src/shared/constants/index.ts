// src/constants/index.ts

/**
 * Application constants
 *
 * Contiene las constantes de la aplicación. La mayoría son fijas; algunas se
 * derivan de variables de entorno a través de ./config (p. ej. el rate limiting
 * relajado en localhost). La configuración de entorno cruda vive en src/config.
 */

import config from './config';
import fieldLabelsModule from './field-labels';

const { FIELD_LABELS, DEFAULT_FIELD_LABEL } = fieldLabelsModule;

// `true` cuando la app corre en una máquina local (LOCALHOST=true en .env).
// En localhost relajamos los límites de rate limiting para no estorbar el desarrollo.
const IS_LOCALHOST = config.server.localhost === 'true';

// ==============================================
// TTLs — tiempos de vida en caché (segundos)
// ==============================================

const TTL = {
  SESSION: 3600, // 1 hora  — caché de sesiones
  REQUEST_LOCK: 2, // 2 seg   — lock de peticiones en red privada
  REQUEST_LOCK_PUBLIC: 3 // 3 seg   — lock de peticiones en red pública
};

// ==============================================
// RATE LIMITING
// ==============================================

const RATE_LIMIT = {
  WINDOW_MS: 900000, // 15 min — público general
  MAX_REQUESTS: IS_LOCALHOST ? 100000 : 100,

  AUTH_WINDOW_MS: 900000, // 15 min — para login/auth real
  AUTH_MAX_REQUESTS: IS_LOCALHOST ? 100000 : 10,

  API_WINDOW_MS: 1000, // 1 seg — para endpoints privados autenticados
  API_MAX_REQUESTS: IS_LOCALHOST ? 100000 : 30, // más generoso que 10

  // [RF-AUTH-02] | CA-01 | Límite propio de /auth/refresh, por SESIÓN (no por IP).
  // El refresh se llama en bucle por diseño (1 cada ~14 min si el access dura 15), así que no puede
  // compartir el cupo de AUTH_MAX_REQUESTS con el login ni contarse por IP: detrás de una IP pública
  // conviven varios usuarios y se consumían el cupo entre sí, quedándose sin renovar la sesión.
  // 30/15min tolera ráfagas del front (varias pantallas montando a la vez) sin abrir la puerta a abuso.
  REFRESH_WINDOW_MS: 900000, // 15 min
  REFRESH_MAX_REQUESTS: IS_LOCALHOST ? 100000 : 30,

  ONE_MINUTE_MS: 60000
};

// ==============================================
// ASSISTANT (Assistant) — límites del chat público
// ==============================================

// [RF-INT-14] | CA-02 | El chat público tiene costo marginal real (tokens del proveedor de IA), a
// diferencia del resto de endpoints públicos. Por eso lleva su propio límite, más ajustado que
// RATE_LIMIT.MAX_REQUESTS, y un tope de turnos por conversación: cada turno reenvía hasta
// MAX_CONTEXT_MESSAGES de historial, así que el costo por turno crece con la conversación.
const ASSISTANT_RATE_LIMIT = {
  WINDOW_MS: 900000, // 15 min
  MAX_REQUESTS: IS_LOCALHOST ? 100000 : 30, // por IP — una conversación normal no pasa de ~20 turnos
  MAX_TURNS_PER_CONVERSATION: 30 // turnos del usuario; superado → iniciar una conversación nueva
};

// ==============================================
// LOGIN ATTEMPTS
// ==============================================

const LOGIN_ATTEMPTS = {
  MAX_ATTEMPTS: 5, // Intentos fallidos antes de bloquear cuenta
  BLOCK_DURATION_MINUTES: 30, // Duración del bloqueo de cuenta (minutos)
  WINDOW_MINUTES: 30 // Ventana de conteo de intentos fallidos (minutos)
};

// ==============================================
// LOGIN RATE LIMIT — contadores Redis por IP y cuenta
// ==============================================

// [RF-AUTH-01] | CA-06 | 5 intentos máx, bloqueo 30 min.
const LOGIN_RATE_LIMIT = {
  // [RF-AUTH-02] | CA-05 | Valores exactos: 10 intentos / 60s ventana / 600s bloqueo
  IP_MAX_ATTEMPTS: IS_LOCALHOST ? 100000 : 10, // Intentos por IP antes de bloquear
  IP_WINDOW_SECS: 60, // Ventana de conteo IP (segundos)
  IP_BLOCK_SECS: IS_LOCALHOST ? 1 : 600, // Duración del bloqueo IP (segundos = 10 min)

  ACCOUNT_MAX_ATTEMPTS: IS_LOCALHOST ? 100000 : 5, // Intentos fallidos antes de bloquear cuenta
  ACCOUNT_WINDOW_SECS: 1800, // Ventana de conteo de cuenta (segundos = 30 min)
  ACCOUNT_BLOCK_SECS: IS_LOCALHOST ? 1 : 1800 // Duración del bloqueo de cuenta (segundos = 30 min)
};

// ==============================================
// FORGOT PASSWORD RATE LIMIT
// ==============================================

const FORGOT_PASSWORD_RATE_LIMIT = {
  MAX_REQUESTS: IS_LOCALHOST ? 100000 : 3,
  WINDOW_MS: 3600000 // 1 hora
};

// ==============================================
// SECURITY
// ==============================================

const SECURITY = {
  RESET_TOKEN_EXPIRATION_MINUTES: 15,
  TOTP_ISSUER: 'BaseProject',
  MAX_ACTIVE_SESSIONS: 5,
  // [RF-AUTH-02] | CA-01/CA-04 | Inactividad unificada para cliente e interno: 15 min sin pegarle a
  // ninguna API cierra la sesión. La señal es last_access_at, que el middleware actualiza en CADA
  // request autenticado. El middleware cierra en el acto en el siguiente request; el worker
  // (session-expiration) barre las sesiones huérfanas que ya no vuelven. Internos re-loguean con 2FA.
  SESSION_INACTIVITY_MINUTES: 15,
  // Throttle de escritura de last_access_at: solo se actualiza si pasaron más de estos segundos
  // desde el último acceso, para no escribir en BD en cada request en ráfaga.
  SESSION_ACCESS_THROTTLE_SECONDS: 60,
  // [RF-AUTH-02] | CA-01 | Tope absoluto de vida de la sesión (Circular 052/2007 SFC).
  // Se verifica en cada refresh y en el worker contra started_at: una sesión no puede extenderse
  // más allá de este límite AUNQUE el usuario siga activo (la rotación del refresh no lo resetea).
  ABSOLUTE_SESSION_LIFETIME_HOURS: 8,
  // [RF-AUTH-02] | CA-01 | Ventana de gracia de la rotación del refresh (segundos).
  // El refresh es de un solo uso: el JTI se revoca al rotar. Pero el front web dispara varias
  // llamadas a la vez al montar pantalla y, con el access recién vencido, todas fallan y todas
  // piden refresh con la MISMA cookie. Sin gracia, la segunda en llegar encuentra el JTI ya
  // revocado y se interpreta como reuse attack. Dentro de esta ventana se devuelve el par ya
  // emitido en vez de declarar incidente. Fuera de ella, el reuse es real.
  REFRESH_ROTATION_GRACE_SECONDS: 60
};

// ==============================================
// CÓDIGOS DE ERROR DE AUTENTICACIÓN (401)
// ==============================================

// [RF-AUTH-02] | CA-01/CA-02 | Todos los 401 salen con `code: 'UNAUTHORIZED'` y mensajes en prosa, así
// que el front no puede distinguir "el access token venció, renová y reintentá" de "la sesión murió,
// mandá a login" — y ante la duda desloguea, que es justo el síntoma reportado. Estos códigos viajan
// en `details.code` (mismo patrón que MFA_REQUIRED en auth.middleware) y son el contrato con el front:
//
//   TOKEN_EXPIRED  → renovar con /auth/refresh y reintentar el request.
//   cualquier otro → desloguear y mandar a login.
const AUTH_ERROR_CODES = {
  TOKEN_EXPIRED: 'TOKEN_EXPIRED', // access token vencido — recuperable con refresh
  TOKEN_INVALID: 'TOKEN_INVALID', // firma inválida / malformado
  SESSION_CLOSED: 'SESSION_CLOSED', // logout, logout-all, revocación admin, rotación
  SESSION_INACTIVITY: 'SESSION_INACTIVITY', // 15 min sin pegarle a ninguna API
  SESSION_ABSOLUTE_LIFETIME: 'SESSION_ABSOLUTE_LIFETIME', // tope de 8h desde started_at
  SESSION_COMPROMISED: 'SESSION_COMPROMISED', // reuse attack — todas las sesiones cerradas
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID', // refresh vencido, revocado o ausente
  DEVICE_BLOCKED: 'DEVICE_BLOCKED' // dispositivo en blocklist (403)
};

// ==============================================
// HTTP STATUS CODES
// ==============================================

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
};

// ==============================================
// RBAC (RF-ADM-01) — roles internos, módulos y matriz de permisos
// ==============================================

import rbac from './rbac';

// Roles con acceso completo al panel admin (acceso total en la matriz): SUPERADMIN + ADMIN.
const ADMIN_ACCESS_ROLES = [...rbac.ADMIN_FULL_ACCESS_ROLES];

// Roles con acceso de lectura a todos los logs del sistema (criterio RF-ADM-03).
// Incluye los roles de administración más AUDITOR, que por definición tiene solo
// lectura en todo el sistema pero debe ver todos los logs regulatorios.
const LOG_READERS = [...ADMIN_ACCESS_ROLES, rbac.RBAC_ROLES.AUDITOR];

// Roles con acceso al portal cliente.
const CLIENT_ACCESS_ROLES = [rbac.RBAC_ROLES.CLIENTE];

// Roles para los que el 2FA es OBLIGATORIO para operar (RF-ADM-01 #6).
// Un usuario con uno de estos roles puede loguearse sin MFA, pero recibirá 403
// en toda acción protegida (requireRole / RbacMiddleware) hasta activarlo.
// Cubre todos los roles internos. Los clientes NO están aquí: su exigencia de
// 2FA se aplica por acción puntual en sus módulos.
const MFA_REQUIRED_ROLES = [...rbac.INTERNAL_ROLE_NAMES];

// ==============================================
// ERROR CODES — identificadores internos
// ==============================================

const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  NOT_FOUND_ERROR: 'NOT_FOUND_ERROR',
  CONFLICT_ERROR: 'CONFLICT_ERROR',
  RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  IDEMPOTENCY_ERROR: 'IDEMPOTENCY_ERROR',
  REQUEST_LOCK_ERROR: 'REQUEST_LOCK_ERROR',
  TOKEN_EXPIRED_ERROR: 'TOKEN_EXPIRED_ERROR',
  TOKEN_INVALID_ERROR: 'TOKEN_INVALID_ERROR'
};

// ==============================================
// SUCCESS MESSAGES
// ==============================================

const SUCCESS_MESSAGES = {
  USER_REGISTERED: 'Usuario registrado exitosamente',
  LOGIN_SUCCESS: 'Inicio de sesión exitoso',
  LOGOUT_SUCCESS: 'Cierre de sesión exitoso',
  PROFILE_UPDATED: 'Perfil actualizado exitosamente',
  PRODUCT_CREATED: 'Producto creado exitosamente',
  PRODUCT_UPDATED: 'Producto actualizado exitosamente',
  PRODUCT_DELETED: 'Producto eliminado exitosamente'
};

// ==============================================
// ERROR MESSAGES — mensajes legibles para el cliente
// ==============================================

// [RF-LP-03] | CA-05 | Mensajes genéricos de sistema
// (auth, rate limit, etc.). No identifican campo — correcto
// para este nivel. Los mensajes por campo viven en los
// validators individuales.
const ERROR_MESSAGES = {
  // Auth
  INVALID_CREDENTIALS: 'Credenciales inválidas',
  ACCOUNT_BLOCKED: 'Cuenta bloqueada temporalmente. Intente más tarde',
  UNAUTHORIZED: 'No autorizado',
  TOKEN_EXPIRED: 'Token expirado',
  TOKEN_INVALID: 'Token inválido',
  TOKEN_REQUIRED: 'Token requerido',

  // User
  USER_NOT_FOUND: 'Usuario no encontrado',
  USER_ALREADY_EXISTS: 'El usuario ya existe',
  USER_INACTIVE: 'Usuario inactivo',

  // Product
  PRODUCT_NOT_FOUND: 'Producto no encontrado',
  INSUFFICIENT_STOCK: 'Stock insuficiente',

  // General
  INTERNAL_ERROR: 'Error interno del servidor',
  VALIDATION_ERROR: 'Error de validación',
  RATE_LIMIT_EXCEEDED: 'Límite de peticiones excedido',
  REQUEST_LOCKED: 'Solicitud en proceso. Por favor espere',
  DUPLICATE_REQUEST: 'Solicitud duplicada detectada',
  FORBIDDEN: 'Acceso denegado'
};

// ==============================================
// REGEX PATTERNS
// ==============================================

const REGEX = {
  EMAIL: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // [RF-AUTH-01] | CA-05 | Regex declara {8,} pero el
  // mínimo efectivo es 10 (impuesto por min(10) en
  // modules/iam/requests/credential.fields.ts). Cosméticamente inconsistente.
  // TODO [RF-AUTH-01][CA-05]: alinear regex a {10,}
  // para que sea autoexplicativo.
  PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d])\S{8,}$/,
  PHONE: /^\+?[1-9]\d{1,14}$/ // E.164 format
};

// ==============================================
// MOCKS — simulación de proveedores externos (RF-INT-01)
// Flag compartido MOCK_EXTERNAL_PROVIDERS: controla el proveedor biométrico y el SMS OTP.
// Default: activo fuera de producción, apagado en producción.
// ==============================================

const MOCKS = {
  EXTERNAL_PROVIDERS: config.mocks?.externalProviders === true
};

// ==============================================
// EXPORTS
// ==============================================

export default {
  // Config (env vars)
  ...config,

  // Constantes fijas
  TTL,
  RATE_LIMIT,
  ASSISTANT_RATE_LIMIT,
  LOGIN_ATTEMPTS,
  LOGIN_RATE_LIMIT,
  FORGOT_PASSWORD_RATE_LIMIT,
  SECURITY,
  AUTH_ERROR_CODES,
  HTTP_STATUS,
  ADMIN_ACCESS_ROLES,
  LOG_READERS,
  CLIENT_ACCESS_ROLES,
  MFA_REQUIRED_ROLES,

  // RBAC (RF-ADM-01)
  RBAC_WILDCARD: rbac.RBAC_WILDCARD,
  RBAC_ROLES: rbac.RBAC_ROLES,
  RBAC_MODULES: rbac.RBAC_MODULES,
  RBAC_MODULE_GROUPS: rbac.RBAC_MODULE_GROUPS,
  RBAC_ACTIONS: rbac.RBAC_ACTIONS,
  RBAC_ALL_ACTIONS: rbac.ALL_ACTIONS,
  ROLE_PERMISSIONS: rbac.ROLE_PERMISSIONS,
  EXTERNAL_ROLE_NAMES: rbac.EXTERNAL_ROLE_NAMES,
  CLIENT_ROLE_NAMES: rbac.CLIENT_ROLE_NAMES,
  INTERNAL_ROLE_NAMES: rbac.INTERNAL_ROLE_NAMES,
  ADMIN_FULL_ACCESS_ROLES: rbac.ADMIN_FULL_ACCESS_ROLES,
  SUPERADMIN_ROLE_NAMES: rbac.SUPERADMIN_ROLE_NAMES,
  ADMIN_NOTIFICATION_ROLE_NAMES: rbac.ADMIN_NOTIFICATION_ROLE_NAMES,

  ERROR_CODES,
  SUCCESS_MESSAGES,
  ERROR_MESSAGES,
  REGEX,

  // Simulación de proveedores externos (RF-INT-01)
  MOCKS,

  // Mensaje de log compartido del gate de 2FA (rbac / auth)
  MFA_NOT_ACTIVE_LOG_MSG: 'Acción bloqueada — 2FA no activo',

  // Consentimientos (RF-ADM-04)
  CONSENT_TYPE_CODES: {
    PRIVACY_POLICY: 'PRIVACY_POLICY',
    COMUNICACIONES_COMERCIALES: 'COMUNICACIONES_COMERCIALES'
  },

  // Etiquetas legibles de campos (auditoría / diffs)
  FIELD_LABELS,
  DEFAULT_FIELD_LABEL
};


