// Puerto de persistencia de la preferencia de notificación (una por usuario). Lo implementa
// infrastructure/persistence/prisma-preference.repository.ts.
import type { NotificationPreference, PreferenceChanges } from '../../domain/notification-preference';

export interface NotificationPreferenceRepository {
  /** null si el usuario nunca la configuró. */
  findByUser(userId: string): Promise<NotificationPreference | null>;
  /** Las de varios usuarios, por user_id (envío masivo: una consulta por página). */
  findByUsers(userIds: readonly string[]): Promise<Map<string, NotificationPreference>>;
  /** Crea o actualiza la del usuario. */
  upsert(userId: string, changes: PreferenceChanges): Promise<NotificationPreference>;
}
