// Preferencia de notificación del usuario: una sola (canales push/email/sms + horario de silencio).
// Las categorías críticas (seguridad, emergencia) la ignoran: esas notificaciones llegan siempre.
import userNotificationPreferenceRepository from '../repositories/user-notification-preference.repository';
import type { PreferenceInput } from '../repositories/user-notification-preference.repository';
import notificationPreferenceDtoModule from '../responses/notification-preference.response';
const { NotificationPreferenceDTO } = notificationPreferenceDtoModule;
import auditModule from '../../audit';
const { audit } = auditModule;

const PREFERENCE_KEYS = ['allowPush', 'allowEmail', 'allowSms', 'quietHoursStart', 'quietHoursEnd'] as const;

/** Solo las keys de preferencia presentes en el body (undefined => no se toca). */
function _pickPreferenceFields(data: PreferenceInput): PreferenceInput {
  return Object.fromEntries(
    PREFERENCE_KEYS.filter(key => data[key] !== undefined).map(key => [key, data[key]])
  ) as PreferenceInput;
}

class NotificationPreferenceService {
  userNotificationPreferenceRepository: typeof userNotificationPreferenceRepository;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones reales:
   *   new NotificationPreferenceService({ userNotificationPreferenceRepository: fake })
   */
  constructor(deps: NotificationPreferenceService.Deps = {}) {
    this.userNotificationPreferenceRepository = deps.userNotificationPreferenceRepository ?? userNotificationPreferenceRepository;
  }

  /** La preferencia del usuario; si nunca la configuró, los valores por defecto (todo permitido). */
  async getPreference(userId: string) {
    const preference = await this.userNotificationPreferenceRepository.findByUser(userId);

    await audit.record('NOTIFICATION_PREFERENCES_VIEWED', {
      actorId: userId,
      details: { configured: preference !== null },
      entityId: preference?.userNotificationPreferenceId,
      entityType: 'UserNotificationPreference',
      entityTable: 'user_notification_preferences'
    });

    return NotificationPreferenceDTO(preference);
  }

  /** Crea o actualiza la preferencia del usuario con los campos enviados. */
  async updatePreference(data: PreferenceInput, userId: string) {
    const updateData = _pickPreferenceFields(data);
    const preference = await this.userNotificationPreferenceRepository.upsert(userId, updateData);

    await audit.record('NOTIFICATION_GLOBAL_PREFERENCE_UPDATED', {
      actorId: userId,
      details: { ...updateData },
      entityId: preference.userNotificationPreferenceId,
      entityType: 'UserNotificationPreference',
      entityTable: 'user_notification_preferences'
    });

    return NotificationPreferenceDTO(preference);
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace NotificationPreferenceService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userNotificationPreferenceRepository?: typeof userNotificationPreferenceRepository;
  }
}

export default Object.assign(new NotificationPreferenceService(), { NotificationPreferenceService });
