// Casos de uso de la traza de operaciones (HTTP, webhooks, workers, sistema): el listado y la línea de
// tiempo de una operación, que une por correlationId su fila de operations, sus operaciones hijas y los
// hechos de negocio que produjo. El paso a paso vive en CloudWatch (la respuesta trae la consulta).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { appliedFilters, pageMetadata, pageRequest, type PageQuery } from '../../../../shared/application/pagination';
import { OperationNotFoundError } from '../../domain/errors';
import type { OperationSource, OperationStatus } from '../../domain/operation';
import type { AuditLogRepository } from '../ports/audit-log-repository.port';
import type { OperationReader } from '../ports/operation-reader.port';
import { toOperationOutput, toOperationTimelineOutput } from '../dto/trace.output';
import { OPERATION_ENTITY } from './audit-entities';

export type OperationListQuery = PageQuery & {
  source?: string | null;
  status?: string | null;
  userId?: string | null;
  name?: string | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
};

export class ListOperations {
  constructor(
    private readonly operations: OperationReader,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, query }: { actorId: string; query: OperationListQuery }) {
    const page = pageRequest(query);
    const { rows, count } = await this.operations.list(
      {
        source: (query.source ?? undefined) as OperationSource | undefined,
        status: (query.status ?? undefined) as OperationStatus | undefined,
        userId: query.userId ?? undefined,
        name: query.name || undefined,
        from: query.dateFrom ?? undefined,
        to: query.dateTo ?? undefined
      },
      page
    );
    const filters = appliedFilters({
      source: query.source,
      status: query.status,
      userId: query.userId,
      name: query.name,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo
    });

    await this.audit.record('OPERATION_LIST_VIEWED', { actorId, details: { totalItems: count, filters: Object.keys(filters) }, ...OPERATION_ENTITY });

    return { data: rows.map(toOperationOutput), metadata: pageMetadata(page, count, filters) };
  }
}

export class GetOperationTimeline {
  constructor(
    private readonly operations: OperationReader,
    private readonly logs: AuditLogRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, operationId }: { actorId: string; operationId: string }) {
    const operation = await this.operations.findById(operationId);
    if (!operation) {
      throw new OperationNotFoundError();
    }
    const [children, auditEvents] = await Promise.all([this.operations.findChildren(operationId), this.logs.findByCorrelationId(operationId)]);

    await this.audit.record('OPERATION_VIEWED', { actorId, ...OPERATION_ENTITY, entityId: operationId });

    return toOperationTimelineOutput({ operation, children, auditEvents });
  }
}
