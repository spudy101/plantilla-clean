// Adaptador Prisma del puerto PushTokenRepository (un endpoint del proveedor por dispositivo).
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { PushDevice, PushTokenRepository } from '../../application/ports/push-token-repository.port';

const daysAgo = (days: number) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
};

const toDevice = (row: { userId: string; token: string }): PushDevice => ({ userId: row.userId, token: row.token });

export class PrismaPushTokenRepository extends PrismaRepository implements PushTokenRepository {
  async findActiveByUser(userId: string): Promise<PushDevice[]> {
    return (await (await this.db()).userPushToken.findMany({ where: { userId, isActive: true } })).map(toDevice);
  }

  async findActiveByUsers(userIds: readonly string[]): Promise<PushDevice[]> {
    return (await (await this.db()).userPushToken.findMany({ where: { userId: { in: [...userIds] }, isActive: true } })).map(toDevice);
  }

  async deactivate(tokens: readonly string[]): Promise<number> {
    if (tokens.length === 0) {
      return 0;
    }
    const { count } = await (await this.db()).userPushToken.updateMany({
      where: { token: { in: [...tokens] }, isActive: true },
      data: { isActive: false }
    });
    return count;
  }

  async deleteInactiveOlderThan(days: number): Promise<number> {
    return (await (await this.db()).userPushToken.deleteMany({ where: { isActive: false, updatedAt: { lt: daysAgo(days) } } })).count;
  }

  /**
   * Registra el dispositivo (iam, al iniciar sesión): si ya existe uno con ese deviceId (o, si no, con ese token)
   * lo reasigna y reactiva; si no, lo crea. Atómico.
   */
  upsertToken(userId: string, token: string, platform: string, deviceId: string | null = null) {
    return this.atomic(async db => {
      const existing =
        (deviceId ? await db.userPushToken.findFirst({ where: { deviceId } }) : null) ?? (await db.userPushToken.findFirst({ where: { token } }));
      const data = { userId, token, platform, deviceId, isActive: true, lastUsedAt: new Date() };
      return existing
        ? db.userPushToken.update({ where: { userPushTokenId: existing.userPushTokenId }, data })
        : db.userPushToken.create({ data });
    });
  }
}
