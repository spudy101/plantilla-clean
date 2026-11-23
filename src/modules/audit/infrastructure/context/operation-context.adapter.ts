// Adaptador del puerto OperationContext: el contexto de la operación en curso (AsyncLocalStorage de
// shared/infrastructure) y la unidad de trabajo activa.
import requestContext from '../../../../shared/infrastructure/observability/request-context.util';
import txContext from '../../../../shared/infrastructure/database/transaction-context';
import type { OperationContext } from '../../application/ports/operation-context.port';
import type { OperationOrigin } from '../../domain/audit-log';

export const operationContextAdapter: OperationContext = {
  origin(): OperationOrigin {
    const ctx = requestContext.getSafe();
    return {
      userId: ctx.userId ?? null,
      sessionId: ctx.sessionId ?? null,
      correlationId: ctx.correlationId,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent,
      fingerprint: ctx.fingerprintHash,
      source: ctx.source as OperationOrigin['source']
    };
  },

  insideUnitOfWork(): boolean {
    return txContext.activeUnit() !== null;
  }
};
