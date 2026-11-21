import AppError from '../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../shared/infrastructure/config';
const { notifications } = constantsModule;
import notificationModule from '../../notification';
const { notifier } = notificationModule;
import auditAlertRepository from '../repositories/audit-alert.repository';
import adminAuditAlertDtoModule from '../responses/admin-audit-alert.response';
const { AuditAlertListDTO } = adminAuditAlertDtoModule;
import audit from '../audit.service';
import type { AlertsAcknowledged } from '../responses/admin-audit-alert.response';
import { pageMetadata, pageRequest } from '../../../shared/application/pagination';
import type { AuditAlertListQuery } from '../requests/audit.request';

class AdminAuditAlertService {
  notifier: typeof notifier;
  auditAlertRepository: typeof auditAlertRepository;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new AdminAuditAlertService({ notifier: fake })
   * @param {object} [deps]
   */
  constructor(deps: AdminAuditAlertService.Deps = {}) {
    this.notifier = deps.notifier ?? notifier;
    this.auditAlertRepository = deps.auditAlertRepository ?? auditAlertRepository;
  }

  async list(query: AuditAlertListQuery, adminUserId: string) {
    const page = pageRequest(query);
    const filters = {
      acknowledged: query.acknowledged ?? undefined,
      dateFrom: query.dateFrom ?? undefined,
      dateTo: query.dateTo ?? undefined,
      action: query.action ?? undefined,
      category: query.category ?? undefined
    };
    const { rows, count } = await this.auditAlertRepository.findAllFiltered(filters, page);

    const pending = await this.auditAlertRepository.countPending();

    await audit.record('AUDIT_ALERT_LISTED', {
      actorId: adminUserId,
      details: { totalItems: count, pending },
      entityType: 'AuditAlert',
      entityTable: 'audit_alerts'
    });

    return {
      data: rows.map(r => AuditAlertListDTO(r)),
      metadata: { ...pageMetadata(page, count, filters), pendingCount: pending }
    };
  }

  async acknowledge(alertId: string, adminUserId: string) {
    const updated = await this.auditAlertRepository.acknowledge(alertId, adminUserId);
    if (!updated) {
      throw AppError.notFound('Alerta no encontrada o ya estaba reconocida');
    }

    const record = await this.auditAlertRepository.findById(alertId);

    await audit.record('AUDIT_ALERT_ACKNOWLEDGED', {
      actorId: adminUserId,
      details: { alertId },
      entityId: alertId,
      entityType: 'AuditAlert',
      entityTable: 'audit_alerts'
    });

    setImmediate(() => {
      this.notifier.notify({
        type: 'AUDIT_ALERT_ACKNOWLEDGED',
        userId: adminUserId,
        relatedEntity: { type: 'AuditAlert', id: alertId },
        metadata: { alertId, logoUrl: notifications.ses.logoUrl }
      }).catch(err => logger.warn('Error enviando AUDIT_ALERT_ACKNOWLEDGED', { error: err.message }));
    });

    return AuditAlertListDTO(record);
  }

  async acknowledgeBulk(alertIds: string[], adminUserId: string) {
    const count = await this.auditAlertRepository.acknowledgeBulk(alertIds, adminUserId);

    await audit.record('AUDIT_ALERTS_BULK_ACKNOWLEDGED', {
      actorId: adminUserId,
      details: { requested: alertIds.length, acknowledged: count },
      entityType: 'AuditAlert',
      entityTable: 'audit_alerts'
    });

    setImmediate(() => {
      this.notifier.notify({
        type: 'AUDIT_ALERTS_BULK_ACKNOWLEDGED',
        userId: adminUserId,
        relatedEntity: null,
        metadata: { acknowledged: count, total: alertIds.length, logoUrl: notifications.ses.logoUrl }
      }).catch(err => logger.warn('Error enviando AUDIT_ALERTS_BULK_ACKNOWLEDGED', { error: err.message }));
    });

    return { acknowledged: count, requested: alertIds.length } satisfies AlertsAcknowledged;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace AdminAuditAlertService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    notifier?: typeof notifier;
    auditAlertRepository?: typeof auditAlertRepository;
  }
}

export default Object.assign(new AdminAuditAlertService(), { AdminAuditAlertService });
