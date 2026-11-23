// Adaptadores: lo que audit necesita de otros módulos para la traza de sesiones y el feed de actividad.
// Viven acá porque conectan módulos; audit no los importa.
//
//   auditSessionsAdapter      SessionDirectory con las sesiones de iam
//   tracedEntitiesAdapter     qué tablas de dominio se pueden mostrar en la traza de una sesión, y cómo
//
// Cuando iam, legal y notification lo permitan, estos adaptadores llamarán a sus casos de uso en vez de a sus
// repositorios; audit no cambia.
import iamModule from '../../modules/iam';
import legalModule from '../../modules/legal';
import notificationModule from '../../modules/notification';
import type { SessionWithDeviceAndUser } from '../../modules/iam';
import type { SessionDirectory, TracedSession } from '../../modules/audit/application/ports/session-directory.port';
import type { TracedEntityRegistry } from '../../modules/audit/application/ports/traced-entity-source.port';

function toTracedSession(s: SessionWithDeviceAndUser): TracedSession {
  return {
    sessionId: s.userSessionId,
    userId: s.userId,
    status: s.status,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    startedAt: s.startedAt,
    lastAccessAt: s.lastAccessAt,
    closedAt: s.closedAt,
    closeReason: s.closeReason,
    createdAt: s.createdAt,
    user: s.sessionUser,
    device: s.device
      ? {
          deviceId: s.device.userTrustedDeviceId,
          deviceName: s.device.deviceName,
          deviceType: s.device.deviceType,
          browser: s.device.browser,
          os: s.device.os,
          status: s.device.status
        }
      : null
  };
}

export const auditSessionsAdapter: SessionDirectory = {
  async list(filters, page) {
    const sessions = iamModule.userSessionRepository;
    const { rows, count } = await sessions.findPaginatedWithDeviceAndUser(sessions.buildWhere(filters), page);
    return { rows: rows.map(toTracedSession), count };
  },

  async findById(sessionId) {
    const session = await iamModule.userSessionRepository.findByIdWithDeviceAndUser(sessionId);
    return session ? toTracedSession(session) : null;
  },

  async exists(sessionId) {
    return (await iamModule.userSessionRepository.findById(sessionId)) !== null;
  },

  async devicesOfOwnSessions(sessionIds, userId) {
    const sessions = await iamModule.userSessionRepository.findByIdsWithDeviceForUser(sessionIds, userId);
    return new Map(
      sessions.map(s => [s.userSessionId, s.device ? { deviceId: s.device.userTrustedDeviceId, name: s.device.deviceName ?? null } : null])
    );
  }
};

/**
 * Las tablas que la traza de sesión sabe mostrar. Sin PII (o enmascarada): esta vista NO es self-view. Una
 * tabla nueva = una entrada más acá.
 */
export const tracedEntitiesAdapter: TracedEntityRegistry = {
  user_consents: {
    entityType: 'UserConsent',
    async findByIds(ids) {
      const consents = await legalModule.userConsentRepository.findByIds(ids);
      return consents.map(c => legalModule.legalComponentsDto.UserConsentComponent.build(c));
    }
  },

  user_notification_preferences: {
    entityType: 'UserNotificationPreference',
    async findByIds(ids) {
      const rows = await notificationModule.notificationPreferenceRepository.findByIds(ids);
      return rows.map(r => ({
        userNotificationPreferenceId: r.userNotificationPreferenceId,
        userId: r.userId,
        allowPush: r.allowPush,
        allowEmail: r.allowEmail,
        allowSms: r.allowSms,
        quietHoursStart: r.quietHoursStart ?? null,
        quietHoursEnd: r.quietHoursEnd ?? null,
        originSessionId: r.originSessionId ?? null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      }));
    }
  },

  user_trusted_devices: {
    entityType: 'UserTrustedDevice',
    async findByIds(ids) {
      const rows = await iamModule.trustedDeviceRepository.findByIds(ids);
      return rows.map(r => ({
        userTrustedDeviceId: r.userTrustedDeviceId,
        userId: r.userId,
        deviceName: r.deviceName ?? null,
        deviceType: r.deviceType ?? null,
        browser: r.browser ?? null,
        os: r.os ?? null,
        status: r.status,
        originSessionId: r.originSessionId ?? null,
        createdAt: r.createdAt
      }));
    }
  }
};
