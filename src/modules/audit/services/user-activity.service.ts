import type UserActivityDto from '../responses/user-activity.response';
import auditLogRepository from '../repositories/audit-log.repository';
import userChangeLogRepository from '../repositories/change-log.repository';
import iamModule from '../../iam';
const { userSessionRepository } = iamModule;
import userActivityDtoModule from '../responses/user-activity.response';
const { UserActivityListResponseDTO } = userActivityDtoModule;
import audit from '../audit.service';
import { pageMetadata, pageRequest } from '../../../shared/http/pagination';
import type { RecentActivityQuery } from '../requests/audit.request';

// Whitelist client-safe del feed: hitos que el usuario entiende y le pertenecen. Nada de acciones
// de solo lectura (*_VIEWED, ruido) ni acciones administrativas. Ampliar acá = aparece en el feed.
const CLIENT_SAFE_AUDIT_ACTIONS = [
  // Sesiones y seguridad
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGIN_BLOCKED_DEVICE',
  'ACCOUNT_BLOCKED',
  'PASSWORD_CHANGED',
  'MFA_TOTP_ACTIVATED',
  'MFA_TOTP_DEACTIVATED',
  'MFA_SMS_ACTIVATED',
  'MFA_SMS_DEACTIVATED',
  'MFA_PREFERRED_METHOD_UPDATED',
  'LOGOUT',
  'LOGOUT_ALL',
  'LOGOUT_OTHERS',
  'SESSION_CLOSED_BY_USER',
  'SESSION_REVOKED_BY_ADMIN',
  // Dispositivos de confianza
  'TRUSTED_DEVICE_ADDED',
  'TRUSTED_DEVICE_ADDED_FIRST',
  'TRUSTED_DEVICE_PENDING',
  'TRUSTED_DEVICE_RENAMED',
  'TRUSTED_DEVICE_REMOVED',
  'TRUSTED_DEVICE_APPROVED',
  'TRUSTED_DEVICE_BLOCKED',
  'TRUSTED_DEVICE_UNBLOCKED',
  // Perfil
  'PROFILE_UPDATED',
  'PROFILE_EMAIL_UPDATED',
  'PROFILE_PHONE_UPDATED',
  'NATIONAL_ID_UPDATED',
  'PRIVACY_POLICY_ACCEPTED'
];

class UserActivityService {
  auditLogRepository: typeof auditLogRepository;
  userChangeLogRepository: typeof userChangeLogRepository;
  userSessionRepository: typeof userSessionRepository;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new UserActivityService({ auditLogRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: UserActivityService.Deps = {}) {
    this.auditLogRepository = deps.auditLogRepository ?? auditLogRepository;
    this.userChangeLogRepository = deps.userChangeLogRepository ?? userChangeLogRepository;
    this.userSessionRepository = deps.userSessionRepository ?? userSessionRepository;
  }

  /**
   * Feed paginado del PROPIO usuario, mezcla de dos fuentes:
   *   - audit_logs (user_id = self) filtrado por la whitelist client-safe — lo que el usuario hizo.
   *   - user_change_logs (user_id = self, changed_by_role admin/system) — lo que un tercero hizo
   *     sobre su cuenta (en audit_logs esos eventos quedan a nombre del admin, no del usuario).
   * Paginación por corte: cada fuente aporta como máximo offset+limit filas, se mezclan por fecha
   * descendente y se corta la página (feed de páginas chicas, no export).
   */
  async getRecentActivity(userId: string, query: RecentActivityQuery) {
    // Orden fijo (más reciente primero): las dos fuentes se mezclan por fecha.
    const { limit, offset, page } = pageRequest({ ...query, sortBy: 'createdAt', order: 'DESC' });

    const fetch = { limit: offset + limit, offset: 0 };

    const [activity, changes] = await Promise.all([
      this.auditLogRepository.findClientSafeByUser(userId, CLIENT_SAFE_AUDIT_ACTIONS, fetch),
      this.userChangeLogRepository.findExternalChangesByUserId(userId, fetch)
    ]);

    const merged = [
      ...activity.rows.map((r): UserActivityDto.Item => ({ __source: 'audit', row: r, at: r.createdAt })),
      ...changes.rows.map((r): UserActivityDto.Item => ({ __source: 'change', row: r, at: r.createdAt }))
    ]
      .sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime())
      .slice(offset, offset + limit);

    const deviceBySession = await this._resolveDevices(merged, userId);

    const totalItems = activity.count + changes.count;

    const metadata = pageMetadata({ page, limit, sortBy: 'createdAt', order: 'DESC' }, totalItems);

    await audit.record('RECENT_ACTIVITY_VIEWED', {
      actorId: userId,
      details: { totalItems, page },
      entityType: 'AuditLog',
      entityTable: 'audit_logs'
    });

    return UserActivityListResponseDTO(merged, metadata, deviceBySession);
  }

  /**
   * Resuelve por lote el dispositivo que ejecutó cada acción de la página: session_id del ítem →
   * user_sessions → device de confianza (nombre). Solo sesiones DEL PROPIO usuario (el repo filtra
   * por user_id): la sesión de un admin que tocó la cuenta nunca expone su dispositivo al cliente.
   * @private
   */
  async _resolveDevices(pageItems: UserActivityDto.Item[], userId: string): Promise<UserActivityDto.DeviceMap> {
    const sessionIds = [
      ...new Set(
        pageItems
          .map(item => (item.__source === 'audit' ? item.row.sessionId : item.row.originSessionId))
          .filter((id): id is string => Boolean(id))
      )
    ];
    if (sessionIds.length === 0) {
      return new Map();
    }

    const sessions = await this.userSessionRepository.findByIdsWithDeviceForUser(sessionIds, userId);
    return new Map(
      sessions.map((s): [string, { deviceId: string; name: string | null } | null] => [
        s.userSessionId,
        s.device ? { deviceId: s.device.userTrustedDeviceId, name: s.device.deviceName ?? null } : null
      ])
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace UserActivityService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    auditLogRepository?: typeof auditLogRepository;
    userChangeLogRepository?: typeof userChangeLogRepository;
    userSessionRepository?: typeof userSessionRepository;
  }
}

export default Object.assign(new UserActivityService(), { UserActivityService });
