// @deprecated TRANSITORIO: la escritura de auditoría para los módulos que todavía no están en Clean (iam,
// approvals), que la importan por el index.ts de audit.
//
// Es el mismo caso de uso RecordAuditEvent que src/main/container.ts entrega como puerto AuditTrail a los
// módulos migrados, armado aquí con sus adaptadores (al primer uso). Cuando el último módulo reciba su
// AuditTrail por el container, este archivo se borra.
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
import { RecordAuditEvent } from '../../application/use-cases/record-audit-event.use-case';
import { RecordAccountChange } from '../../application/use-cases/record-account-change.use-case';
import type { AccountChange } from '../../domain/account-change';
import type { AuditActionKey } from '../../domain/audit-action';
import type { AuditFact } from '../../domain/audit-log';
import { operationContextAdapter } from '../context/operation-context.adapter';
import { PrismaAuditAlertRepository } from '../persistence/prisma-audit-alert.repository';
import { PrismaAuditLogRepository } from '../persistence/prisma-audit-log.repository';

let recorder: { event: RecordAuditEvent; change: RecordAccountChange } | null = null;

function useCases() {
  if (!recorder) {
    const event = new RecordAuditEvent(
      new PrismaAuditLogRepository(),
      new PrismaAuditAlertRepository(),
      operationContextAdapter,
      loggerUtilModule.logger
    );
    recorder = { event, change: new RecordAccountChange(event) };
  }
  return recorder;
}

export default {
  /** La acción es una clave del catálogo: un typo no compila. */
  record(action: AuditActionKey, fact: AuditFact): Promise<void> {
    return useCases().event.execute(action, fact);
  },

  /** Bitácora: un USER_FIELD_CHANGED sobre la cuenta, con el valor anterior y el nuevo. */
  recordChange(change: AccountChange): Promise<void> {
    return useCases().change.execute(change);
  }
};
