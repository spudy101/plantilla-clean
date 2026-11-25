// Puerto: las sesiones (tabla user_sessions). Los cierres devuelven cuántas filas cerraron (solo las activas).
import type { PageRequest } from '../../../../shared/application/pagination';
import type { ClosableSession, SessionFilters, SessionKey, SessionWithDeviceAndUser, UserSession } from '../../domain/session';

export interface NewSession {
  userSessionId: string;
  userId: string;
  deviceId: string | null;
  jti: string;
  ipAddress: string | null;
  userAgent: string | null;
  startedAt: Date;
  lastAccessAt: Date;
}

export interface SessionRepository {
  create(session: NewSession): Promise<UserSession>;
  findById(sessionId: string): Promise<UserSession | null>;
  /** Solo si sigue activa. */
  findActiveById(sessionId: string): Promise<UserSession | null>;
  findActiveByUser(userId: string): Promise<UserSession[]>;
  findActiveByUserExcept(userId: string, exceptSessionId: string | null): Promise<SessionKey[]>;
  findActiveByUserAndDevice(userId: string, deviceId: string): Promise<SessionKey[]>;
  findOldestActive(userId: string): Promise<UserSession | null>;
  countActive(userId: string): Promise<number>;
  /** Activas con last_access_at < inactivityCutoff o started_at < absoluteCutoff. */
  findClosable(inactivityCutoff: Date, absoluteCutoff: Date): Promise<ClosableSession[]>;
  /** Solo las del propio usuario, con su dispositivo (el feed de actividad del cliente). */
  findDevicesOfOwnSessions(
    sessionIds: string[],
    userId: string
  ): Promise<Array<{ userSessionId: string; device: { userTrustedDeviceId: string; deviceName: string } | null }>>;
  findPaginatedWithDeviceAndUser(filters: SessionFilters, page: PageRequest): Promise<{ rows: SessionWithDeviceAndUser[]; count: number }>;
  findByIdWithDeviceAndUser(sessionId: string): Promise<SessionWithDeviceAndUser | null>;

  touchLastAccess(sessionId: string): Promise<number>;
  updateJtiAndLastAccess(sessionId: string, jti: string): Promise<number>;
  close(sessionId: string, reason: string): Promise<number>;
  closeAllByUser(userId: string, reason: string): Promise<number>;
  closeAllByUserExcept(userId: string, exceptSessionId: string | null, reason: string): Promise<number>;
}
