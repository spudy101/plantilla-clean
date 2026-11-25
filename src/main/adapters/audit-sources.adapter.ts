// Adaptadores: lo que audit necesita de otros módulos para la traza de sesiones y el feed de actividad.
// Viven acá porque conectan módulos; audit no los importa.
//
//   auditSessions      SessionDirectory con las sesiones de iam
//   tracedEntities     qué tablas de dominio se pueden mostrar en la traza de una sesión, y cómo
import type { SessionWithDeviceAndUser } from '../../modules/iam/domain/session';
import type { SessionDirectory, TracedSession } from '../../modules/audit/application/ports/session-directory.port';
import type { TracedEntityRegistry } from '../../modules/audit/application/ports/traced-entity-source.port';
import type { ModuleRegistry } from './module-registry';

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

export function auditSessionsAdapter(modules: ModuleRegistry): SessionDirectory {
  const sessions = () => modules.iam.directories.sessions;
  return {
    async list(filters, page) {
      const { rows, count } = await sessions().list(filters, page);
      return { rows: rows.map(toTracedSession), count };
    },

    async findById(sessionId) {
      const session = await sessions().findById(sessionId);
      return session ? toTracedSession(session) : null;
    },

    exists: sessionId => sessions().exists(sessionId),

    async devicesOfOwnSessions(sessionIds, userId) {
      const rows = await sessions().devicesOfOwnSessions(sessionIds, userId);
      return new Map(rows.map(s => [s.userSessionId, s.device ? { deviceId: s.device.userTrustedDeviceId, name: s.device.deviceName ?? null } : null]));
    }
  };
}

/**
 * Las tablas que la traza de sesión sabe mostrar. Sin PII (o enmascarada): esta vista NO es self-view. Una tabla
 * nueva = una entrada más acá.
 */
export function tracedEntitiesAdapter(modules: ModuleRegistry): TracedEntityRegistry {
  return {
    user_consents: {
      entityType: 'UserConsent',
      findByIds: ids => modules.legal.useCases.findConsentsByIds.execute(ids)
    },

    user_notification_preferences: {
      entityType: 'UserNotificationPreference',
      async findByIds(ids) {
        const rows = await modules.notification.useCases.findPreferencesByIds.execute(ids);
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
        const rows = await modules.iam.directories.sessions.devicesByIds(ids);
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
}
