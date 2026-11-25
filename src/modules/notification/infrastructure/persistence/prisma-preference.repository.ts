// Adaptador Prisma del puerto NotificationPreferenceRepository (una por usuario). El horario de silencio (TIME)
// entra y sale como texto 'HH:MM:SS'. origin_session_id lo completa la extensión de Prisma al crear.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import { toTime } from '../../../../shared/infrastructure/database/prisma-time';
import type { NotificationPreferenceRepository } from '../../application/ports/preference-repository.port';
import type { NotificationPreference, PreferenceChanges } from '../../domain/notification-preference';
import { NotificationMapper } from './notification.mapper';

function preferenceData({ quietHoursStart, quietHoursEnd, ...flags }: PreferenceChanges) {
  return {
    ...flags,
    ...(quietHoursStart !== undefined ? { quietHoursStart: toTime(quietHoursStart) } : {}),
    ...(quietHoursEnd !== undefined ? { quietHoursEnd: toTime(quietHoursEnd) } : {})
  };
}

export class PrismaNotificationPreferenceRepository extends PrismaRepository implements NotificationPreferenceRepository {
  async findByUser(userId: string): Promise<NotificationPreference | null> {
    const row = await (await this.db()).userNotificationPreference.findUnique({ where: { userId } });
    return row ? NotificationMapper.preferenceToDomain(row) : null;
  }

  async findByUsers(userIds: readonly string[]): Promise<Map<string, NotificationPreference>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await (await this.db()).userNotificationPreference.findMany({ where: { userId: { in: [...userIds] } } });
    return new Map(rows.map(row => [row.userId, NotificationMapper.preferenceToDomain(row)]));
  }

  /** Filas por id (la traza de sesión de audit las muestra). */
  async findByIds(ids: readonly string[]): Promise<NotificationPreference[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await (await this.db()).userNotificationPreference.findMany({ where: { userNotificationPreferenceId: { in: [...ids] } } });
    return rows.map(NotificationMapper.preferenceToDomain);
  }

  async upsert(userId: string, changes: PreferenceChanges): Promise<NotificationPreference> {
    const data = preferenceData(changes);
    const row = await (await this.db()).userNotificationPreference.upsert({ where: { userId }, update: data, create: { userId, ...data } });
    return NotificationMapper.preferenceToDomain(row);
  }
}
