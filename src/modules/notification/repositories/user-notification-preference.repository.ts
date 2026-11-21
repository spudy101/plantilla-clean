// Preferencia de notificación del usuario: una sola por usuario (canales permitidos + horario de
// silencio). Las categorías críticas la ignoran. El horario (TIME) entra y sale como texto 'HH:MM:SS'
// (prisma-time). origin_session_id lo completa la extensión de Prisma al crear.
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { UserNotificationPreference } from '../../../shared/database/generated/prisma/client';
import { fromTime, toTime } from '../../../shared/database/prisma-time';

type TimeFields = 'quietHoursStart' | 'quietHoursEnd';
/** Preferencia con el horario de silencio como texto. */
export type PreferenceRow = Omit<UserNotificationPreference, TimeFields> & {
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
};

/** Preferencias tal como llegan del DTO de entrada; undefined = no se toca. */
export interface PreferenceInput {
  allowPush?: boolean;
  allowEmail?: boolean;
  allowSms?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
}

function toRow(row: UserNotificationPreference): PreferenceRow {
  return { ...row, quietHoursStart: fromTime(row.quietHoursStart), quietHoursEnd: fromTime(row.quietHoursEnd) };
}

function toData({ quietHoursStart, quietHoursEnd, ...flags }: PreferenceInput) {
  return {
    ...flags,
    ...(quietHoursStart !== undefined ? { quietHoursStart: toTime(quietHoursStart) } : {}),
    ...(quietHoursEnd !== undefined ? { quietHoursEnd: toTime(quietHoursEnd) } : {})
  };
}

class UserNotificationPreferenceRepository extends PrismaRepository {
  /** La preferencia del usuario; null si nunca la configuró (todo permitido, sin horario de silencio). */
  async findByUser(userId: string): Promise<PreferenceRow | null> {
    const row = await (await this.db()).userNotificationPreference.findUnique({ where: { userId } });
    return row && toRow(row);
  }

  /** Las de varios usuarios, por user_id (envío masivo: una consulta por página). */
  async findByUsers(userIds: readonly string[]): Promise<Map<string, PreferenceRow>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await (await this.db()).userNotificationPreference.findMany({ where: { userId: { in: [...userIds] } } });
    return new Map(rows.map(row => [row.userId, toRow(row)]));
  }

  /** Filas por id (hidratación del session-trace). */
  async findByIds(ids: readonly string[]): Promise<PreferenceRow[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await (
      await this.db()
    ).userNotificationPreference.findMany({ where: { userNotificationPreferenceId: { in: [...ids] } } });
    return rows.map(toRow);
  }

  /** Crea o actualiza la preferencia del usuario. */
  async upsert(userId: string, input: PreferenceInput): Promise<PreferenceRow> {
    const data = toData(input);
    const row = await (
      await this.db()
    ).userNotificationPreference.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data }
    });
    return toRow(row);
  }
}

export default new UserNotificationPreferenceRepository();
