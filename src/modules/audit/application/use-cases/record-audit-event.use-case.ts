// Caso de uso: registrar un hecho de negocio. Es la ÚNICA puerta de escritura de la auditoría: la usan
// todos los módulos a través del puerto AuditTrail.
//
// - Se clasifica con el catálogo; quién, desde dónde y en qué operación sale del contexto de la operación.
// - Se escribe dentro de la unidad de trabajo en curso: el cambio y su auditoría quedan juntos o ninguno.
//   Los intentos fallidos (outcome ≠ success) se escriben aparte: esa unidad se va a revertir.
// - Si la acción alerta, crea también la alerta para el Superadmin.
// - Fuera de una unidad de trabajo, un fallo al escribir se reporta y no rompe el flujo (el cambio ya está
//   hecho); dentro, se relanza para que el cambio no quede sin su auditoría.
// - S3 no se escribe aquí: la copia fría se exporta por lotes diarios (ExportAuditDay).
import type { Logger } from '../../../../shared/application/ports/logger.port';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import { alertFor, auditLogFor, type AuditFact } from '../../domain/audit-log';
import type { AuditAlertRepository } from '../ports/audit-alert-repository.port';
import type { AuditLogRepository } from '../ports/audit-log-repository.port';
import type { OperationContext } from '../ports/operation-context.port';

const { errorMessage } = errorMessageModule;

export class RecordAuditEvent {
  constructor(
    private readonly logs: AuditLogRepository,
    private readonly alerts: AuditAlertRepository,
    private readonly context: OperationContext,
    private readonly logger: Logger
  ) {}

  async execute(action: string, fact: AuditFact): Promise<void> {
    const origin = this.context.origin();
    const { log, independent } = auditLogFor(action, fact, origin);
    const insideUnit = !independent && this.context.insideUnitOfWork();

    try {
      const saved = await this.logs.append(log, { independent });
      const alert = alertFor(saved);
      if (alert) {
        await this.alerts.create(alert, { independent });
      }
      this.logger.debug('audit', { action, outcome: log.outcome, correlationId: origin.correlationId });
    } catch (error) {
      if (insideUnit) {
        throw error;
      }
      this.logger.error('No se pudo registrar la auditoría', { action, correlationId: origin.correlationId, error: errorMessage(error) });
    }
  }
}
