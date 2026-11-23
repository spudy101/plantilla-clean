// Caso de uso: el detalle de un registro de auditoría (con details redactado).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { AuditLogNotFoundError } from '../../domain/errors';
import type { AuditLogRepository } from '../ports/audit-log-repository.port';
import { toAuditLogDetailOutput } from '../dto/audit-log.output';
import { AUDIT_LOG_ENTITY } from './audit-entities';

export class GetAuditLog {
  constructor(
    private readonly logs: AuditLogRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, auditLogId }: { actorId: string; auditLogId: string }) {
    const log = await this.logs.findById(auditLogId);
    if (!log) {
      throw new AuditLogNotFoundError();
    }

    await this.audit.record('AUDIT_LOG_VIEWED', { actorId, details: { auditLogId }, entityId: auditLogId, ...AUDIT_LOG_ENTITY });

    return toAuditLogDetailOutput(log);
  }
}
