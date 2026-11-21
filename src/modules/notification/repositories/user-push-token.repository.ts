// modules/schemas/notification/repositories/user-push-token.repository.ts
//
// Tokens push por dispositivo. origin_session_id lo completa la extensión de Prisma al crear.
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { UserPushToken } from '../../../shared/infrastructure/database/generated/prisma/client';

class UserPushTokenRepository extends PrismaRepository {
  async findActiveByUser(userId: string): Promise<UserPushToken[]> {
    return (await this.db()).userPushToken.findMany({ where: { userId, isActive: true } });
  }

  async findActiveByUsers(userIds: string[]): Promise<UserPushToken[]> {
    return (await this.db()).userPushToken.findMany({ where: { userId: { in: userIds }, isActive: true } });
  }

  /**
   * Registra el token del dispositivo: si ya existe uno con ese deviceId (o, si no, con ese token) lo
   * reasigna y reactiva; si no, lo crea. Atómico.
   */
  upsertToken(userId: string, token: string, platform: string, deviceId: string | null = null): Promise<UserPushToken> {
    return this.atomic(async db => {
      const existing =
        (deviceId ? await db.userPushToken.findFirst({ where: { deviceId } }) : null) ??
        (await db.userPushToken.findFirst({ where: { token } }));
      const data = { userId, token, platform, deviceId, isActive: true, lastUsedAt: new Date() };
      return existing
        ? db.userPushToken.update({ where: { userPushTokenId: existing.userPushTokenId }, data })
        : db.userPushToken.create({ data });
    });
  }

  /**
   * Desactiva los tokens de dispositivos dados de baja por el proveedor (SNS EndpointDisabled): no se les
   * vuelve a enviar. Si el usuario registra de nuevo el dispositivo, upsertToken lo reactiva. Devuelve cuántos.
   */
  async deactivateTokens(tokens: readonly string[]): Promise<number> {
    if (tokens.length === 0) {
      return 0;
    }
    const { count } = await (await this.db()).userPushToken.updateMany({
      where: { token: { in: [...tokens] }, isActive: true },
      data: { isActive: false }
    });
    return count;
  }

  /** Elimina tokens inactivos sin cambios hace más de `daysOld` días; devuelve cuántos. */
  async deleteOldInactive(daysOld = 90): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);
    return (await (await this.db()).userPushToken.deleteMany({ where: { isActive: false, updatedAt: { lt: cutoff } } })).count;
  }
}

export default new UserPushTokenRepository();
