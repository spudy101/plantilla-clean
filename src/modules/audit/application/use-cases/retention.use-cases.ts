// Casos de uso de retención (RF-ADM-03). Los corre el worker de infrastructure/workers.
//
//   RunAuditRetention   mensual: avisa cuántos registros vencen el período caliente en el próximo año y, si
//                       el Superadmin activó la purga, borra de la base los vencidos (la copia queda en S3).
//   ExportAuditDay      diario: copia fría del día (UTC) a S3 como un único JSONL.
//   PurgeTechnicalData  diario: traza de operaciones y claves de idempotencia vencidas (no son auditoría).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import { archiveKeyOf, daysBefore, expiringCutoff, hotYearsOf, purgeCutoff, utcDayOf } from '../../domain/retention';
import type { AuditArchive } from '../ports/audit-archive.port';
import type { AuditLogRepository } from '../ports/audit-log-repository.port';
import type { RetentionSettingsReader } from '../ports/retention-settings.port';
import type { TechnicalDataRetention } from '../ports/technical-data-retention.port';
import { AUDIT_LOG_ENTITY } from './audit-entities';

const { errorMessage } = errorMessageModule;

export class RunAuditRetention {
  constructor(
    private readonly logs: AuditLogRepository,
    private readonly settings: RetentionSettingsReader,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  /**
   * Avisa siempre; purga solo con `enableDbPurge: true` (operación destructiva: una corrida manual sin el
   * flag nunca borra). Nunca lanza: un error se loguea.
   */
  async execute({ enableDbPurge = false }: { enableDbPurge?: boolean } = {}): Promise<void> {
    try {
      const hotYears = hotYearsOf(await this.settings.read());
      await this.warnExpiring(hotYears);
      if (enableDbPurge) {
        await this.purgeExpired(hotYears);
      }
    } catch (err) {
      this.logger.error('audit-archive.worker — error en ejecución', { error: errorMessage(err) });
    }
  }

  /** La corrida del cron: purga solo si el Superadmin la activó en la configuración (apagada por defecto). */
  async executeScheduled(): Promise<void> {
    const settings = await this.settings.read();
    await this.execute({ enableDbPurge: settings?.hotPurgeEnabled === true });
  }

  private async warnExpiring(hotYears: number) {
    const cutoff = expiringCutoff(new Date(), hotYears);
    const count = await this.logs.countCreatedUpTo(cutoff);
    if (count > 0) {
      this.logger.warn('audit-archive.worker — registros próximos a vencer período caliente', {
        count,
        hotYears,
        cutoffDate: cutoff.toISOString()
      });
    } else {
      this.logger.info('audit-archive.worker — sin registros próximos a vencer', { hotYears });
    }
  }

  private async purgeExpired(hotYears: number) {
    const cutoff = purgeCutoff(new Date(), hotYears);
    const count = await this.logs.countCreatedBefore(cutoff);
    if (count === 0) {
      this.logger.info('audit-archive.worker — sin registros vencidos para purgar');
      return;
    }

    this.logger.warn('audit-archive.worker — iniciando purga de BD', { count, cutoffDate: cutoff.toISOString() });
    // SFC/RF-ADM-03: la purga destructiva queda auditada al empezar y al terminar
    await this.audit.record('AUDIT_LOG_PURGE_EXECUTED', {
      actorId: 'system',
      details: { status: 'initiated', candidateCount: count, cutoffDate: cutoff.toISOString(), hotYears },
      ...AUDIT_LOG_ENTITY
    });

    await this.logs.purgeCreatedBefore(cutoff);
    this.logger.info('audit-archive.worker — purga completada', { purged: count });

    await this.audit.record('AUDIT_LOG_PURGE_EXECUTED', {
      actorId: 'system',
      details: { status: 'completed', purgedCount: count, cutoffDate: cutoff.toISOString(), hotYears },
      ...AUDIT_LOG_ENTITY
    });
  }
}

export class ExportAuditDay {
  constructor(
    private readonly logs: AuditLogRepository,
    private readonly archive: AuditArchive,
    private readonly logger: Logger
  ) {}

  /** Exporta el día (UTC) que contiene `day`; devuelve cuántos registros exportó. Re-exportar es seguro. */
  async execute(day: Date): Promise<number> {
    const { from, to } = utcDayOf(day);
    const rows = await this.logs.findCreatedBetween(from, to);
    if (rows.length === 0) {
      this.logger.info('audit-archive.worker — sin registros para exportar', { day: from.toISOString().slice(0, 10) });
      return 0;
    }
    const key = archiveKeyOf(from);
    await this.archive.upload(key, `${rows.map(r => JSON.stringify(r)).join('\n')}\n`);
    this.logger.info('audit-archive.worker — día exportado a S3', { key, count: rows.length });
    return rows.length;
  }
}

export class PurgeTechnicalData {
  constructor(
    private readonly retention: TechnicalDataRetention,
    private readonly operationsRetentionDays: number,
    private readonly logger: Logger
  ) {}

  /** Cada purga es independiente: si una falla, la otra corre igual (y después se reporta la falla). */
  async execute(): Promise<void> {
    const results = await Promise.allSettled([this.purgeOperations(), this.purgeIdempotencyKeys()]);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) {
      throw failed.reason;
    }
  }

  private async purgeOperations() {
    const cutoff = daysBefore(new Date(), this.operationsRetentionDays);
    const purged = await this.retention.purgeOperationsBefore(cutoff);
    this.logger.info('audit-archive.worker — operaciones purgadas', { purged, cutoffDate: cutoff.toISOString() });
    return purged;
  }

  private async purgeIdempotencyKeys() {
    const purged = await this.retention.purgeExpiredIdempotencyKeys();
    this.logger.info('audit-archive.worker — claves de idempotencia vencidas purgadas', { purged });
    return purged;
  }
}
