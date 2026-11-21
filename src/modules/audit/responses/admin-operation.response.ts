// Salida de la traza de operaciones (admin). Lista blanca: ni payloads de proveedores ni detalles
// internos más allá de lo que sirve para reconstruir qué pasó.
import type { PageMetadata } from '../../../shared/http/pagination';
import { z } from '../../../shared/validation/z';
import { dateTime } from '../../../shared/validation/output';
import type { AuditLog, Operation } from '../../../shared/database/generated/prisma/client';

const operationItem = (o: Operation) => ({
  operationId: o.operationId,
  parentId: o.parentId,
  clientRequestId: o.clientRequestId,
  source: o.source,
  name: o.name,
  status: o.status,
  httpStatus: o.httpStatus,
  errorCode: o.errorCode,
  errorMessage: o.errorMessage,
  userId: o.userId,
  sessionId: o.sessionId,
  ip: o.ip,
  startedAt: o.startedAt,
  endedAt: o.endedAt,
  durationMs: o.durationMs
});

function OperationListDTO(rows: Operation[], metadata: PageMetadata) {
  return { data: rows.map(operationItem), metadata };
}

function OperationTimelineDTO({
  operation,
  children,
  auditEvents
}: {
  operation: Operation;
  children: Operation[];
  auditEvents: AuditLog[];
}) {
  return {
    operation: operationItem(operation),
    children: children.map(operationItem),
    auditEvents: auditEvents.map(a => ({
      auditLogId: a.auditLogId,
      action: a.action,
      description: a.description,
      outcome: a.outcome,
      risk: a.risk,
      userId: a.userId,
      entityType: a.entityType,
      entityId: a.entityId,
      at: a.createdAt
    })),
    // Los logs paso a paso viven en CloudWatch (incluidas las llamadas a proveedores, una línea
    // `[Provider]` por llamada): esta consulta de Logs Insights los trae en orden
    logsQuery: `fields @timestamp, level, message | filter correlationId = "${operation.operationId}" | sort @timestamp asc`
  };
}

export default { OperationListDTO, OperationTimelineDTO };

// ── Esquemas de salida ──
export const OperationSchema = z.object({
  operationId: z.uuid().meta({ description: 'Id de la operación = correlationId de logs y auditoría.' }),
  parentId: z.uuid().nullable().meta({ description: 'Operación que originó esta.' }),
  clientRequestId: z.string().nullable().meta({ description: 'X-Correlation-Id / X-Request-Id que envió el cliente.' }),
  source: z.enum(['http', 'webhook', 'worker', 'system']),
  name: z.string().meta({ example: 'PUT /admin/api/v1/kyc/persons/:userId/role' }),
  status: z.enum(['running', 'success', 'failure']),
  httpStatus: z.number().int().nullable().meta({ example: 200 }),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  userId: z.uuid().nullable(),
  sessionId: z.uuid().nullable(),
  ip: z.string().nullable(),
  startedAt: dateTime(),
  endedAt: dateTime().nullable(),
  durationMs: z.number().int().nullable()
});

export const OperationTimelineSchema = z.object({
  operation: OperationSchema,
  children: z.array(OperationSchema),
  auditEvents: z
    .array(
      z.object({
        auditLogId: z.uuid(),
        action: z.string(),
        description: z.string().nullable(),
        outcome: z.string(),
        risk: z.string(),
        userId: z.uuid().nullable(),
        entityType: z.string().nullable(),
        entityId: z.string().nullable(),
        at: dateTime()
      })
    )
    .meta({ description: 'Hechos de negocio (audit_logs) de la operación, en orden.' }),
  logsQuery: z
    .string()
    .meta({ description: 'Consulta de CloudWatch Logs Insights con los logs paso a paso, incluidas las llamadas a proveedores externos.' })
});
