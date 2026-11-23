// Caso de uso: el feed de actividad del PROPIO usuario (cliente). Mezcla lo que hizo (acciones client-safe)
// con lo que un admin o el sistema cambió en su cuenta. Paginación por corte: cada fuente aporta como máximo
// offset+limit filas, se mezclan por fecha y se corta la página (feed de páginas chicas, no exportación).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { pageMetadata, pageRequest } from '../../../../shared/application/pagination';
import { CLIENT_SAFE_AUDIT_ACTIONS, EXTERNAL_CHANGE_ROLES, mergeFeed, sessionIdsOf } from '../../domain/activity-feed';
import type { AuditLogRepository } from '../ports/audit-log-repository.port';
import type { ChangeLogRepository } from '../ports/change-log-repository.port';
import type { SessionDirectory } from '../ports/session-directory.port';
import { toActivityFeedOutput } from '../dto/trace.output';
import { AUDIT_LOG_ENTITY } from './audit-entities';

export class GetRecentActivity {
  constructor(
    private readonly logs: AuditLogRepository,
    private readonly changes: ChangeLogRepository,
    private readonly sessions: SessionDirectory,
    private readonly audit: AuditTrail
  ) {}

  async execute({ userId, query }: { userId: string; query: { page: number; limit: number } }) {
    // Orden fijo (más reciente primero): las dos fuentes se mezclan por fecha
    const { limit, offset, page } = pageRequest({ ...query, sortBy: 'createdAt', order: 'DESC' });
    const window = { limit: offset + limit, offset: 0 };

    const [own, external] = await Promise.all([
      this.logs.findOwnActivity(userId, CLIENT_SAFE_AUDIT_ACTIONS, window),
      this.changes.findChangesBy(userId, EXTERNAL_CHANGE_ROLES, window)
    ]);
    const items = mergeFeed(own.rows, external.rows, offset, limit);

    const sessionIds = sessionIdsOf(items);
    const devices = sessionIds.length === 0 ? new Map() : await this.sessions.devicesOfOwnSessions(sessionIds, userId);

    const totalItems = own.count + external.count;
    const metadata = pageMetadata({ page, limit, sortBy: 'createdAt', order: 'DESC' }, totalItems);

    await this.audit.record('RECENT_ACTIVITY_VIEWED', { actorId: userId, details: { totalItems, page }, ...AUDIT_LOG_ENTITY });

    return toActivityFeedOutput(items, metadata, devices);
  }
}
