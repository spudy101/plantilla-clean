// GET /records/audit/operations — traza de operaciones (HTTP, webhooks, workers, sistema).
//
// La línea de tiempo de una operación une por correlationId lo que vive en BD: la fila de `operations`
// (inicio, fin, resultado), sus operaciones hijas y los hechos de negocio (audit_logs). El detalle paso
// a paso vive en CloudWatch, incluidas las llamadas a proveedores externos: la respuesta trae la
// consulta de Logs Insights lista para pegar.
import AppError from '../../../shared/http/app-error.util';
import operationRepository from '../../../shared/observability/operation.repository';
import auditLogRepository from '../repositories/audit-log.repository';
import adminOperationDtoModule from '../responses/admin-operation.response';
const { OperationListDTO, OperationTimelineDTO } = adminOperationDtoModule;
import audit from '../audit.service';
import { appliedFilters, pageMetadata, pageRequest } from '../../../shared/http/pagination';
import type { OperationListQuery } from '../requests/audit.request';

type OperationFilters = NonNullable<Parameters<(typeof operationRepository)['findAllPaginated']>[0]>;

type OperationReader = Pick<typeof operationRepository, 'findAllPaginated' | 'findById' | 'findChildren'>;
type AuditReader = Pick<typeof auditLogRepository, 'findByCorrelationId'>;

const ENTITY = { entityType: 'Operation', entityTable: 'operations' };

class AdminOperationService {
  operationRepository: OperationReader;
  auditLogRepository: AuditReader;

  constructor(deps: AdminOperationService.Deps = {}) {
    this.operationRepository = deps.operationRepository ?? operationRepository;
    this.auditLogRepository = deps.auditLogRepository ?? auditLogRepository;
  }

  async list(query: OperationListQuery, adminUserId: string) {
    const page = pageRequest(query);
    const { rows, count } = await this.operationRepository.findAllPaginated(
      {
        source: (query.source ?? undefined) as OperationFilters['source'],
        status: (query.status ?? undefined) as OperationFilters['status'],
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

    await audit.record('OPERATION_LIST_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count, filters: Object.keys(filters) },
      ...ENTITY
    });

    return OperationListDTO(rows, pageMetadata(page, count, filters));
  }

  async timeline(operationId: string, adminUserId: string) {
    const operation = await this.operationRepository.findById(operationId);
    if (!operation) {
      throw AppError.notFound('Operación no encontrada');
    }
    const [children, auditEvents] = await Promise.all([
      this.operationRepository.findChildren(operationId),
      this.auditLogRepository.findByCorrelationId(operationId)
    ]);

    await audit.record('OPERATION_VIEWED', { actorId: adminUserId, ...ENTITY, entityId: operationId });

    return OperationTimelineDTO({ operation, children, auditEvents });
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace AdminOperationService {
  interface Deps {
    operationRepository?: OperationReader;
    auditLogRepository?: AuditReader;
  }
}

export default Object.assign(new AdminOperationService(), { AdminOperationService });
