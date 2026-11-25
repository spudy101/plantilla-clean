// La preferencia de notificación del titular: verla (si nunca la configuró, los valores por defecto) y
// cambiarla (solo los campos enviados).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { preferenceChanges, type PreferenceChanges } from '../../domain/notification-preference';
import { toPreferenceOutput } from '../dto/notification.output';
import type { NotificationPreferenceRepository } from '../ports/preference-repository.port';

const ENTITY = { entityType: 'UserNotificationPreference', entityTable: 'user_notification_preferences' } as const;

export class GetNotificationPreference {
  constructor(
    private readonly preferences: Pick<NotificationPreferenceRepository, 'findByUser'>,
    private readonly audit: AuditTrail
  ) {}

  async execute(userId: string) {
    const preference = await this.preferences.findByUser(userId);
    await this.audit.record('NOTIFICATION_PREFERENCES_VIEWED', {
      actorId: userId,
      details: { configured: preference !== null },
      entityId: preference?.userNotificationPreferenceId,
      ...ENTITY
    });
    return toPreferenceOutput(preference);
  }
}

export class UpdateNotificationPreference {
  constructor(
    private readonly preferences: Pick<NotificationPreferenceRepository, 'upsert'>,
    private readonly audit: AuditTrail
  ) {}

  async execute({ userId, changes }: { userId: string; changes: PreferenceChanges }) {
    const applied = preferenceChanges(changes);
    const preference = await this.preferences.upsert(userId, applied);
    await this.audit.record('NOTIFICATION_GLOBAL_PREFERENCE_UPDATED', {
      actorId: userId,
      details: { ...applied },
      entityId: preference.userNotificationPreferenceId,
      ...ENTITY
    });
    return toPreferenceOutput(preference);
  }
}
