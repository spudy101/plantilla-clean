// Caso de uso: exportar la auditoría filtrada (hasta EXPORT_LIMIT filas, las más recientes). El formato del
// archivo (CSV o XLSX) lo arma la presentación; acá se arman las filas y se audita la exportación.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { AuditLogRepository } from '../ports/audit-log-repository.port';
import { toAuditLogExportRow } from '../dto/audit-log.output';
import { AUDIT_LOG_ENTITY } from './audit-entities';
import { definedFilters, type AuditLogQueryFilters } from './list-audit-logs.use-case';

export const EXPORT_LIMIT = 50000;

export type ExportFormat = 'csv' | 'xlsx';

export class ExportAuditLogs {
  constructor(
    private readonly logs: AuditLogRepository,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  async execute({ actorId, filters, format }: { actorId: string; filters: AuditLogQueryFilters; format: ExportFormat }) {
    const logs = await this.logs.findForExport(definedFilters(filters), EXPORT_LIMIT);
    const truncated = logs.length === EXPORT_LIMIT;

    await this.audit.record('AUDIT_LOG_EXPORTED', {
      actorId,
      details: { format, count: logs.length, truncated },
      ...AUDIT_LOG_ENTITY
    });
    this.logger.info('AdminAuditLogService.export', { adminUserId: actorId, format, count: logs.length, truncated });

    return { rows: logs.map(toAuditLogExportRow), truncated };
  }
}
