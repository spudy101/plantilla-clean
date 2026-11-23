// modules/schemas/kyc/iam/repositories/user-session.repository.ts
//
// Sesiones de usuario. user_sessions no declara relación con users en el schema, así que el usuario de
// las vistas admin (`sessionUser`) se adjunta con una consulta por lote (loadUserRefs).
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../shared/application/pagination';
import { UserSessionStatus } from '../../../shared/infrastructure/database/generated/prisma/client';
import type { Prisma, UserSession } from '../../../shared/infrastructure/database/generated/prisma/client';
import { loadUserRefs, type UserRef } from '../../../shared/infrastructure/database/user-ref';
const DEVICE_REF = {
  device: { select: { userTrustedDeviceId: true, deviceName: true, deviceType: true, browser: true, os: true, status: true } }
} satisfies Prisma.UserSessionInclude;

type SessionWithDevice = Prisma.UserSessionGetPayload<{ include: typeof DEVICE_REF }>;
/** Cabecera de sesión para vistas admin: dispositivo + usuario. */
export type SessionWithDeviceAndUser = SessionWithDevice & { sessionUser: UserRef | null };

const SESSION_KEY = { userSessionId: true, jti: true } satisfies Prisma.UserSessionSelect;
const ACTIVE = UserSessionStatus.active;
const closeData = (reason: string) => ({ status: UserSessionStatus.closed, closedAt: new Date(), closeReason: reason });
const isStatus = (v: unknown): v is UserSessionStatus => Object.values(UserSessionStatus).includes(v as UserSessionStatus);

class UserSessionRepository extends PrismaRepository {
  async create(data: Prisma.UserSessionUncheckedCreateInput): Promise<UserSession> {
    return (await this.db()).userSession.create({ data });
  }

  async findById(userSessionId: string): Promise<UserSession | null> {
    return (await this.db()).userSession.findUnique({ where: { userSessionId } });
  }

  /**
   * Lote de sesiones con su dispositivo de confianza (feed de actividad del cliente). Filtra por
   * `userId` a propósito: solo se resuelven sesiones DEL PROPIO usuario (una sesión ajena —p. ej. la del
   * admin que hizo un cambio sobre la cuenta— jamás expone su dispositivo al cliente).
   */
  async findByIdsWithDeviceForUser(sessionIds: string[], userId: string) {
    if (sessionIds.length === 0) {
      return [];
    }
    return (await this.db()).userSession.findMany({
      where: { userSessionId: { in: sessionIds }, userId },
      select: { userSessionId: true, deviceId: true, device: { select: { userTrustedDeviceId: true, deviceName: true } } }
    });
  }

  async findActiveByUser(userId: string): Promise<UserSession[]> {
    return (await this.db()).userSession.findMany({ where: { userId, status: ACTIVE }, orderBy: { startedAt: 'desc' } });
  }

  /** Sesión por id solo si sigue activa (null si no existe o ya se cerró). */
  async findActiveById(userSessionId: string): Promise<UserSession | null> {
    return (await this.db()).userSession.findFirst({ where: { userSessionId, status: ACTIVE } });
  }

  /** Renueva last_access_at (ventana deslizante de inactividad). Devuelve cuántas filas tocó. */
  async touchLastAccess(userSessionId: string): Promise<number> {
    return (await (await this.db()).userSession.updateMany({ where: { userSessionId }, data: { lastAccessAt: new Date() } }))
      .count;
  }

  async updateJtiAndLastAccess(userSessionId: string, jti: string): Promise<number> {
    return (await (await this.db()).userSession.updateMany({ where: { userSessionId }, data: { jti, lastAccessAt: new Date() } }))
      .count;
  }

  /** Cierra la sesión si sigue activa. Devuelve cuántas cerró (0 o 1). */
  async closeSession(userSessionId: string, reason: string): Promise<number> {
    return (await (await this.db()).userSession.updateMany({ where: { userSessionId, status: ACTIVE }, data: closeData(reason) }))
      .count;
  }

  async closeAllByUser(userId: string, reason: string): Promise<number> {
    return (await (await this.db()).userSession.updateMany({ where: { userId, status: ACTIVE }, data: closeData(reason) })).count;
  }

  /** Cierra las activas del usuario salvo `exceptSessionId` (sin sesión actual, token viejo: todas). */
  async closeAllByUserExcept(userId: string, exceptSessionId: string | null, reason: string): Promise<number> {
    return (
      await (await this.db()).userSession.updateMany({ where: activeExcept(userId, exceptSessionId), data: closeData(reason) })
    ).count;
  }

  async findActiveByUserExcept(userId: string, exceptSessionId: string | null) {
    return (await this.db()).userSession.findMany({ where: activeExcept(userId, exceptSessionId), select: SESSION_KEY });
  }

  async findActiveByUserAndDevice(userId: string, deviceId: string) {
    return (await this.db()).userSession.findMany({ where: { userId, deviceId, status: ACTIVE }, select: SESSION_KEY });
  }

  // [RF-AUTH-03] | CA-04 | Conteo de sesiones activas y selección de la más antigua;
  // usado por _enforceSessionLimit para aplicar el límite de 5 sesiones
  async findOldestActive(userId: string): Promise<UserSession | null> {
    return (await this.db()).userSession.findFirst({ where: { userId, status: ACTIVE }, orderBy: { startedAt: 'asc' } });
  }

  async countActive(userId: string): Promise<number> {
    return (await this.db()).userSession.count({ where: { userId, status: ACTIVE } });
  }

  // [RF-AUTH-02] | CA-01/CA-04 | Sesiones activas que el worker debe cerrar: por inactividad
  // (last_access_at < inactivityCutoff) O por tope absoluto de vida (started_at < absoluteCutoff).
  async findClosableActive(inactivityCutoff: Date, absoluteCutoff: Date) {
    return (await this.db()).userSession.findMany({
      where: { status: ACTIVE, OR: [{ lastAccessAt: { lt: inactivityCutoff } }, { startedAt: { lt: absoluteCutoff } }] },
      select: { userSessionId: true, userId: true, jti: true, lastAccessAt: true, startedAt: true }
    });
  }

  /** Listado paginado admin con dispositivo y usuario de cada sesión. */
  async findPaginatedWithDeviceAndUser(
    where: Prisma.UserSessionWhereInput,
    page: PageRequest
  ): Promise<PrismaRepository.Page<SessionWithDeviceAndUser>> {
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.userSession.findMany({ where, include: DEVICE_REF, ...this.paginationArgs(page, 'userSessionId') }),
      db.userSession.count({ where })
    ]);
    return { rows: await this.attachUsers(rows), count };
  }

  /** Detalle de una sesión con dispositivo y usuario. */
  async findByIdWithDeviceAndUser(userSessionId: string): Promise<SessionWithDeviceAndUser | null> {
    const row = await (await this.db()).userSession.findUnique({ where: { userSessionId }, include: DEVICE_REF });
    return row ? (await this.attachUsers([row]))[0]! : null;
  }

  /** `where` del listado admin a partir de los filtros de la query. Un estado desconocido no devuelve filas. */
  buildWhere({
    sessionId,
    userId,
    status,
    ip,
    dateFrom,
    dateTo
  }: UserSessionRepository.Filters = {}): Prisma.UserSessionWhereInput {
    const where: Prisma.UserSessionWhereInput = {};
    if (sessionId) {
      where.userSessionId = sessionId;
    }
    if (userId) {
      where.userId = userId;
    }
    if (status) {
      // Postgres rechazaría un valor fuera del enum: se responde vacío
      where.status = isStatus(status) ? status : { in: [] };
    }
    if (ip) {
      where.ipAddress = ip;
    }
    if (dateFrom || dateTo) {
      where.startedAt = { ...(dateFrom ? { gte: new Date(dateFrom) } : {}), ...(dateTo ? { lte: new Date(dateTo) } : {}) };
    }
    return where;
  }

  private async attachUsers(rows: SessionWithDevice[]): Promise<SessionWithDeviceAndUser[]> {
    const users = await loadUserRefs(
      await this.db(),
      rows.map(r => r.userId)
    );
    return rows.map(r => ({ ...r, sessionUser: users.get(r.userId) ?? null }));
  }
}

function activeExcept(userId: string, exceptSessionId: string | null): Prisma.UserSessionWhereInput {
  return { userId, status: ACTIVE, ...(exceptSessionId ? { userSessionId: { not: exceptSessionId } } : {}) };
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace UserSessionRepository {
  /** Filtros del listado admin (llegan de la query string). */
  export interface Filters {
    sessionId?: string;
    userId?: string;
    status?: unknown;
    ip?: string;
    dateFrom?: string | Date;
    dateTo?: string | Date;
  }
}

export default new UserSessionRepository();
