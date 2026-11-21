// modules/schemas/kyc/iam/repositories/auth-trusted-device.repository.ts
//
// Dispositivos de confianza del usuario. hmac_secret va cifrado (piiExtension): se genera acá y se lee
// en claro.
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { Prisma, UserTrustedDevice } from '../../../shared/infrastructure/database/generated/prisma/client';
import AppError from '../../../shared/presentation/http/app-error.util';
import HmacService from '../services/hmac.service';

/** Última sesión del dispositivo (activa o cerrada), para mostrar su estado y último acceso. */
const LAST_SESSION = {
  sessions: {
    select: {
      userSessionId: true,
      status: true,
      ipAddress: true,
      userAgent: true,
      startedAt: true,
      lastAccessAt: true,
      closedAt: true,
      closeReason: true
    },
    orderBy: { lastAccessAt: 'desc' },
    take: 1
  }
} satisfies Prisma.UserTrustedDeviceInclude;

export type TrustedDeviceWithLastSession = Prisma.UserTrustedDeviceGetPayload<{ include: typeof LAST_SESSION }>;

/** Alta de dispositivo: hmac_secret lo genera el repositorio (el llamador no lo conoce). */
export type TrustedDeviceInput = Pick<Prisma.UserTrustedDeviceUncheckedCreateInput, 'userId' | 'fingerprintHash' | 'deviceName'> &
  Partial<
    Pick<
      Prisma.UserTrustedDeviceUncheckedCreateInput,
      'status' | 'ipAddress' | 'city' | 'country' | 'countryCode' | 'browser' | 'os' | 'deviceType' | 'trustedAt' | 'lastSeenAt'
    >
  >;

class TrustedDeviceRepository extends PrismaRepository {
  // ============================================================
  // CONSULTAS
  // ============================================================

  async findById(userTrustedDeviceId: string): Promise<UserTrustedDevice | null> {
    return (await this.db()).userTrustedDevice.findUnique({ where: { userTrustedDeviceId } });
  }

  /** Dispositivo del usuario por fingerprint, cualquiera sea su estado. */
  async findByFingerprint(userId: string, fingerprintHash: string): Promise<UserTrustedDevice | null> {
    return (await this.db()).userTrustedDevice.findUnique({ where: { userId_fingerprintHash: { userId, fingerprintHash } } });
  }

  /**
   * Primer dispositivo con ese fingerprint, de cualquier usuario (verificación HMAC, que solo recibe el
   * X-Device-Id). Mismo criterio que antes de Prisma.
   */
  async findAnyByFingerprint(fingerprintHash: string): Promise<UserTrustedDevice | null> {
    return (await this.db()).userTrustedDevice.findFirst({ where: { fingerprintHash } });
  }

  /** Dispositivo por id, solo si pertenece al usuario. */
  async findByIdAndUser(userTrustedDeviceId: string, userId: string): Promise<UserTrustedDevice | null> {
    return (await this.db()).userTrustedDevice.findFirst({ where: { userTrustedDeviceId, userId } });
  }

  /** Filas por id (hidratación del session-trace). */
  async findByIds(ids: readonly string[]): Promise<UserTrustedDevice[]> {
    if (ids.length === 0) {
      return [];
    }
    return (await this.db()).userTrustedDevice.findMany({ where: { userTrustedDeviceId: { in: [...ids] } } });
  }

  /** Dispositivos del usuario con su última sesión, más recientes primero. */
  async findAllByUserWithSessions(userId: string): Promise<TrustedDeviceWithLastSession[]> {
    return (await this.db()).userTrustedDevice.findMany({
      where: { userId },
      include: LAST_SESSION,
      orderBy: { lastSeenAt: 'desc' }
    });
  }

  /** Dispositivos PENDING del usuario (para aprobarlos o rechazarlos desde uno trusted). */
  async findAllPending(userId: string): Promise<UserTrustedDevice[]> {
    return (await this.db()).userTrustedDevice.findMany({ where: { userId, status: 'pending' }, orderBy: { createdAt: 'desc' } });
  }

  /** Dispositivos TRUSTED del usuario (el primero va directo a trusted). */
  async countTrusted(userId: string): Promise<number> {
    return (await this.db()).userTrustedDevice.count({ where: { userId, status: 'trusted' } });
  }

  // ============================================================
  // ESCRITURA
  // ============================================================

  /** Crea un dispositivo; el status se pasa explícito ('pending' o 'trusted'). */
  async create(data: TrustedDeviceInput): Promise<UserTrustedDevice> {
    return (await this.db()).userTrustedDevice.create({
      data: {
        userId: data.userId,
        fingerprintHash: data.fingerprintHash,
        deviceName: data.deviceName,
        status: data.status || 'pending',
        ipAddress: data.ipAddress || null,
        city: data.city || null,
        country: data.country || null,
        countryCode: data.countryCode || null,
        browser: data.browser || null,
        os: data.os || null,
        deviceType: data.deviceType || 'desktop',
        trustedAt: data.trustedAt || null,
        lastSeenAt: data.lastSeenAt || new Date(),
        // Secret único por dispositivo: se genera acá y lo cifra la extensión de Prisma
        hmacSecret: HmacService.generateDeviceSecret()
        // origin_session_id queda null por diseño: el dispositivo se registra DURANTE el login, antes de
        // que la sesión exista, y es su padre (user_sessions.device_id apunta acá). La extensión completa
        // el correlationId del request de login.
      }
    });
  }

  /** Aprueba un dispositivo PENDING: registra qué dispositivo trusted lo aprobó y cuándo. */
  approve(deviceId: string, approvedByDeviceId: string): Promise<UserTrustedDevice> {
    const now = new Date();
    return this.updateOrFail(deviceId, { status: 'trusted', trustedAt: now, approvedByDeviceId, approvedAt: now });
  }

  /** Rechaza (elimina) un dispositivo PENDING: no se guarda historial de rechazos. */
  async reject(deviceId: string): Promise<number> {
    return (await (await this.db()).userTrustedDevice.deleteMany({ where: { userTrustedDeviceId: deviceId } })).count;
  }

  /** Bloquea un dispositivo: registra qué dispositivo trusted lo bloqueó y cuándo. */
  block(deviceId: string, blockedByDeviceId: string): Promise<UserTrustedDevice> {
    return this.updateOrFail(deviceId, { status: 'blocked', blockedByDeviceId, blockedAt: new Date() });
  }

  /** Desbloquea un dispositivo BLOCKED (vuelve a 'pending') y limpia los campos de bloqueo. */
  unblock(deviceId: string): Promise<UserTrustedDevice> {
    return this.updateOrFail(deviceId, { status: 'pending', blockedByDeviceId: null, blockedAt: null });
  }

  /** Actualiza last_seen_at: en cada login exitoso desde un dispositivo conocido. */
  async updateLastSeen(userId: string, fingerprintHash: string): Promise<number> {
    return (
      await (
        await this.db()
      ).userTrustedDevice.updateMany({ where: { userId, fingerprintHash }, data: { lastSeenAt: new Date() } })
    ).count;
  }

  rename(deviceId: string, deviceName: string): Promise<UserTrustedDevice> {
    return this.updateOrFail(deviceId, { deviceName });
  }

  /** Elimina todos los dispositivos del usuario (logoutAll). */
  async deleteAllByUser(userId: string): Promise<number> {
    return (await (await this.db()).userTrustedDevice.deleteMany({ where: { userId } })).count;
  }

  private async updateOrFail(
    userTrustedDeviceId: string,
    data: Prisma.UserTrustedDeviceUncheckedUpdateManyInput
  ): Promise<UserTrustedDevice> {
    const [row] = await (await this.db()).userTrustedDevice.updateManyAndReturn({ where: { userTrustedDeviceId }, data });
    if (!row) {
      throw AppError.notFound('Dispositivo no encontrado');
    }
    return row;
  }
}

export default new TrustedDeviceRepository();
