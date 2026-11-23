// Una operación del sistema (request HTTP, webhook, worker, evento de sistema): modelo de solo lectura de la
// tabla operations. Su id es el correlationId de los logs y de los registros de auditoría que produjo.
//
// El detalle paso a paso vive en CloudWatch (incluidas las llamadas a proveedores): esta consulta de Logs
// Insights lo trae en orden.

export type OperationSource = 'http' | 'webhook' | 'worker' | 'system';
export type OperationStatus = 'running' | 'success' | 'failure';

export interface OperationEntry {
  operationId: string;
  parentId: string | null;
  clientRequestId: string | null;
  source: OperationSource;
  name: string;
  status: OperationStatus;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  userId: string | null;
  sessionId: string | null;
  ip: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
}

export function logsInsightsQueryFor(operationId: string): string {
  return `fields @timestamp, level, message | filter correlationId = "${operationId}" | sort @timestamp asc`;
}
