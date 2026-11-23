// Puerto: las sesiones de usuario (son de iam). src/main/adapters/audit-sessions.adapter.ts lo implementa con
// el módulo iam; audit no lo importa.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { UserRef } from '../../domain/audit-log';
import type { Page } from './audit-log-repository.port';

/** Dispositivo de confianza desde el que se abrió la sesión. */
export interface SessionDevice {
  deviceId: string;
  deviceName: string | null;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
  status: string | null;
}

/** Cabecera de una sesión para la traza: identidad, dispositivo, IP, ventana temporal y estado. */
export interface TracedSession {
  sessionId: string;
  userId: string;
  status: string;
  ipAddress: string | null;
  userAgent: string | null;
  startedAt: Date;
  lastAccessAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
  createdAt: Date;
  user: UserRef | null;
  device: SessionDevice | null;
}

export interface SessionFilters {
  userId?: string;
  sessionId?: string;
  status?: string;
  ip?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
}

export interface SessionDirectory {
  list(filters: SessionFilters, page: PageRequest): Promise<Page<TracedSession>>;
  findById(sessionId: string): Promise<TracedSession | null>;
  exists(sessionId: string): Promise<boolean>;
  /**
   * Dispositivo de cada sesión, SOLO de las sesiones del propio `userId` (la sesión del admin que tocó la
   * cuenta nunca expone su equipo al cliente). Sesión sin dispositivo → null; sesión ajena → ausente.
   */
  devicesOfOwnSessions(sessionIds: string[], userId: string): Promise<Map<string, { deviceId: string; name: string | null } | null>>;
}
