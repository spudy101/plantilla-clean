// Casos de uso: un administrador reconoce una alerta, o varias de una vez. Se audita y se le avisa por el
// Notifier después de responder (el aviso nunca frena ni rompe el reconocimiento).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { Notification, Notifier } from '../../../../shared/application/ports/notifier.port';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import { PendingAlertNotFoundError } from '../../domain/errors';
import type { AuditAlertRepository } from '../ports/audit-alert-repository.port';
import { toAuditAlertOutput } from '../dto/audit-log.output';
import { AUDIT_ALERT_ENTITY } from './audit-entities';

const { errorMessage } = errorMessageModule;

/** El aviso sale en el siguiente ciclo del event loop, cuando la respuesta ya se armó. */
function notifyAfterResponse(notifier: Notifier, logger: Logger, notification: Notification) {
  setImmediate(() => {
    notifier.notify(notification).catch(err => logger.warn(`Error enviando ${notification.type}`, { error: errorMessage(err) }));
  });
}

export class AcknowledgeAuditAlert {
  constructor(
    private readonly alerts: AuditAlertRepository,
    private readonly audit: AuditTrail,
    private readonly notifier: Notifier,
    private readonly logger: Logger,
    private readonly logoUrl: string
  ) {}

  async execute({ actorId, alertId }: { actorId: string; alertId: string }) {
    const updated = await this.alerts.acknowledge([alertId], actorId);
    if (!updated) {
      throw new PendingAlertNotFoundError();
    }
    const alert = await this.alerts.findById(alertId);

    await this.audit.record('AUDIT_ALERT_ACKNOWLEDGED', { actorId, details: { alertId }, entityId: alertId, ...AUDIT_ALERT_ENTITY });

    notifyAfterResponse(this.notifier, this.logger, {
      type: 'AUDIT_ALERT_ACKNOWLEDGED',
      userId: actorId,
      relatedEntity: { type: 'AuditAlert', id: alertId },
      metadata: { alertId, logoUrl: this.logoUrl }
    });

    return alert ? toAuditAlertOutput(alert) : null;
  }
}

export class AcknowledgeAuditAlerts {
  constructor(
    private readonly alerts: AuditAlertRepository,
    private readonly audit: AuditTrail,
    private readonly notifier: Notifier,
    private readonly logger: Logger,
    private readonly logoUrl: string
  ) {}

  async execute({ actorId, alertIds }: { actorId: string; alertIds: string[] }) {
    const acknowledged = await this.alerts.acknowledge(alertIds, actorId);

    await this.audit.record('AUDIT_ALERTS_BULK_ACKNOWLEDGED', {
      actorId,
      details: { requested: alertIds.length, acknowledged },
      ...AUDIT_ALERT_ENTITY
    });

    notifyAfterResponse(this.notifier, this.logger, {
      type: 'AUDIT_ALERTS_BULK_ACKNOWLEDGED',
      userId: actorId,
      relatedEntity: null,
      metadata: { acknowledged, total: alertIds.length, logoUrl: this.logoUrl }
    });

    return { acknowledged, requested: alertIds.length };
  }
}
