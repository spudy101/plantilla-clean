// Sesiones de usuario (user_sessions): una por login, atada al dispositivo desde el que se inició. Se cierran por
// logout, por inactividad, por tope absoluto de vida, por límite de sesiones simultáneas o por un administrador.
export type SessionStatus = 'active' | 'closed';

export interface UserSession {
  userSessionId: string;
  userId: string;
  deviceId: string | null;
  jti: string;
  ipAddress: string | null;
  userAgent: string | null;
  status: SessionStatus;
  startedAt: Date;
  lastAccessAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Lo justo para cerrar una sesión y revocar su refresh token. */
export interface SessionKey {
  userSessionId: string;
  jti: string;
}

/** Una sesión que el worker puede tener que cerrar. */
export interface ClosableSession extends SessionKey {
  userId: string;
  lastAccessAt: Date;
  startedAt: Date;
}

/** Cabecera de sesión para las vistas admin: su dispositivo y su usuario. */
export interface SessionWithDeviceAndUser extends UserSession {
  device: {
    userTrustedDeviceId: string;
    deviceName: string;
    deviceType: string;
    browser: string | null;
    os: string | null;
    status: string;
  } | null;
  /** Quién inició la sesión (user_sessions no declara la relación: se adjunta aparte). */
  sessionUser: { userId: string; username: string | null; person: { firstName: string | null; lastName: string | null } | null } | null;
}

/** Filtros del listado admin de sesiones. Un estado desconocido no devuelve filas. */
export interface SessionFilters {
  sessionId?: string;
  userId?: string;
  status?: unknown;
  ip?: string;
  dateFrom?: string | Date;
  dateTo?: string | Date;
}

/** Política de sesiones (la fija la configuración de seguridad). */
export interface SessionPolicy {
  /** Sesiones simultáneas por usuario. */
  maxActiveSessions: number;
  /** Minutos sin pegarle a ninguna API antes de cerrar la sesión. */
  inactivityMinutes: number;
  /** Segundos mínimos entre dos escrituras de last_access_at. */
  accessThrottleSeconds: number;
  /** Horas de vida máxima de una sesión desde started_at, aunque el usuario siga activo. */
  absoluteLifetimeHours: number;
}

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/** ¿La sesión superó su tope absoluto de vida? (la rotación del refresh no lo resetea) */
export function exceededAbsoluteLifetime(session: Pick<UserSession, 'startedAt'>, policy: SessionPolicy, now = Date.now()): boolean {
  return now >= new Date(session.startedAt).getTime() + policy.absoluteLifetimeHours * MS_PER_HOUR;
}

/** Milisegundos desde el último acceso. */
export function idleMs(session: Pick<UserSession, 'lastAccessAt'>, now = Date.now()): number {
  return now - new Date(session.lastAccessAt).getTime();
}

export function isIdleTooLong(idle: number, policy: SessionPolicy): boolean {
  return idle > policy.inactivityMinutes * MS_PER_MINUTE;
}

/** Ventana deslizante con throttle: solo se escribe last_access_at si pasó el umbral. */
export function shouldTouch(idle: number, policy: SessionPolicy): boolean {
  return idle > policy.accessThrottleSeconds * 1000;
}

/** Los cortes del barrido del worker: por inactividad y por tope absoluto. */
export function sweepCutoffs(policy: SessionPolicy, now = Date.now()) {
  return {
    inactivityCutoff: new Date(now - policy.inactivityMinutes * MS_PER_MINUTE),
    absoluteCutoff: new Date(now - policy.absoluteLifetimeHours * MS_PER_HOUR)
  };
}

/** Por qué cierra el worker una sesión: si superó el tope absoluto prevalece esa razón; si no, es inactividad. */
export function sweepReason(session: Pick<ClosableSession, 'startedAt'>, absoluteCutoff: Date) {
  const exceededAbsolute = new Date(session.startedAt) < absoluteCutoff;
  return exceededAbsolute
    ? ({ reason: 'absolute_lifetime', auditAction: 'SESSION_ABSOLUTE_EXPIRED' } as const)
    : ({ reason: 'inactivity_timeout', auditAction: 'SESSION_EXPIRED_BY_WORKER' } as const);
}
