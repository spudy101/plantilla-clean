import cron from 'node-cron';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import { runOperation } from '../../../shared/observability/operation';
import auditLogRepository from '../repositories/audit-log.repository';
import operationRepository from '../../../shared/observability/operation.repository';
import idempotencyRepository from '../../../shared/http/idempotency/idempotency.repository';
import constantsModule from '../../../shared/constants';
const { logging } = constantsModule;
import settingsModule from '../../settings';
const { systemGlobalConfigRepository } = settingsModule;
import S3Util from '../../../shared/infra/s3.util';
import errorMessageModule from '../../../shared/utils/error-message.util';

const { errorMessage } = errorMessageModule;
import audit from '../audit.service';


// [RF-AUTH-01] | CA-07 | Retención mínima 5 años
// en BD (hot). Archivado S3 STANDARD_IA posterior.
// Configurable via audit_retention_hot_years.
// Cumple Circular ADC-2007 SFC.
const DEFAULT_HOT_YEARS = 5;
const PURGE_AUDIT_META = { entityType: 'AuditLog', entityTable: 'audit_logs' };

// Cron mensual: día 1 a las 07:00. La purga destructiva queda DESACTIVADA por defecto
// (enableDbPurge:false) — solo corre el aviso de retención. Activar la purga requiere
// invocación manual con { enableDbPurge: true } (operación destructiva, aprobación del dev).
const RETENTION_CRON = '0 7 1 * *';

/**
 * Worker de archivado de auditoría (RF-ADM-03).
 *
 * Terraform gestiona el S3 lifecycle (Standard-IA → Glacier) de forma declarativa.
 * Este worker complementa desde la aplicación:
 *   1. Loguea cuántos registros de BD están próximos a vencer el período caliente,
 *      para que el Superadmin sea consciente de cuándo ocurrirá la purga.
 *   2. Purga de BD (solo con opts.enableDbPurge = true): elimina registros que
 *      superaron el período caliente. Requiere aprobación explícita del desarrollador
 *      por ser una operación destructiva.
 */
const run = async (opts: { enableDbPurge?: boolean } = {}) => {
  try {
    const config = await systemGlobalConfigRepository.findActive();
    const hotYears = config?.auditRetentionHotYears ?? DEFAULT_HOT_YEARS;

    await _logExpiringRecords(hotYears);

    if (opts.enableDbPurge) {
      await _purgeExpiredFromDb(hotYears);
    }
  } catch (err) {
    logger.error('audit-archive.worker — error en ejecución', { error: errorMessage(err) });
  }
};

async function _logExpiringRecords(hotYears: number) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - hotYears + 1);

  const expiringCount = await auditLogRepository.countCreatedUpTo(cutoff);

  if (expiringCount > 0) {
    logger.warn('audit-archive.worker — registros próximos a vencer período caliente', {
      count: expiringCount,
      hotYears,
      cutoffDate: cutoff.toISOString()
    });
  } else {
    logger.info('audit-archive.worker — sin registros próximos a vencer', { hotYears });
  }
}

/**
 * Elimina de BD los registros que vencieron el período caliente.
 * Usa SET LOCAL para autorizar la operación ante el trigger de inmutabilidad.
 */
async function _purgeExpiredFromDb(hotYears: number) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - hotYears);

  const count = await auditLogRepository.countCreatedBefore(cutoff);

  if (count === 0) {
    logger.info('audit-archive.worker — sin registros vencidos para purgar');
    return;
  }

  logger.warn('audit-archive.worker — iniciando purga de BD', { count, cutoffDate: cutoff.toISOString() });

  // SFC/RF-ADM-03: la purga destructiva de auditoría debe quedar auditada (inicio).
  await audit.record('AUDIT_LOG_PURGE_EXECUTED', {
    actorId: 'system',
    details: { status: 'initiated', candidateCount: count, cutoffDate: cutoff.toISOString(), hotYears },
    ...PURGE_AUDIT_META
  });

  await auditLogRepository.purgeCreatedBefore(cutoff);

  logger.info('audit-archive.worker — purga completada', { purged: count });

  // SFC/RF-ADM-03: confirmación de la purga ejecutada (fin) — quién/cuántos/cutoff.
  await audit.record('AUDIT_LOG_PURGE_EXECUTED', {
    actorId: 'system',
    details: { status: 'completed', purgedCount: count, cutoffDate: cutoff.toISOString(), hotYears },
    ...PURGE_AUDIT_META
  });
}

// Diario a las 03:30: retención de datos técnicos de alto volumen y vida corta (no son auditoría): la
// traza de operaciones y las claves de idempotencia vencidas.
const OPERATIONS_RETENTION_CRON = '30 3 * * *';
const MS_PER_DAY = 86_400_000;

// Diario a las 02:15 (UTC): exporta a S3 el día anterior completo como un único JSONL.
const ARCHIVE_EXPORT_CRON = '15 2 * * *';

/**
 * Copia fría de la auditoría: un objeto por día (audit-logs/AAAA/MM/DD.jsonl), una línea por registro.
 * Sobrescribe la key del día: reintentar o re-exportar es seguro. Devuelve cuántos registros exportó.
 */
async function exportDay(day: Date): Promise<number> {
  const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const to = new Date(from.getTime() + MS_PER_DAY);
  const rows = await auditLogRepository.findCreatedBetween(from, to);
  if (rows.length === 0) {
    logger.info('audit-archive.worker — sin registros para exportar', { day: from.toISOString().slice(0, 10) });
    return 0;
  }
  const [yyyy, mm, dd] = from.toISOString().slice(0, 10).split('-');
  const key = `audit-logs/${yyyy}/${mm}/${dd}.jsonl`;
  await S3Util.uploadArchive(key, `${rows.map(r => JSON.stringify(r)).join('\n')}\n`);
  logger.info('audit-archive.worker — día exportado a S3', { key, count: rows.length });
  return rows.length;
}

/** Borra las operaciones más viejas que `logging.operationsRetentionDays`. */
async function purgeOperations(): Promise<number> {
  const cutoff = new Date(Date.now() - logging.operationsRetentionDays * MS_PER_DAY);
  const purged = await operationRepository.purgeOlderThan(cutoff);
  logger.info('audit-archive.worker — operaciones purgadas', { purged, cutoffDate: cutoff.toISOString() });
  return purged;
}

/** Borra las claves de idempotencia vencidas (se recuerdan 24 h; ver docs/idempotency.md). */
async function purgeIdempotencyKeys(): Promise<number> {
  const purged = await idempotencyRepository.purgeExpired();
  logger.info('audit-archive.worker — claves de idempotencia vencidas purgadas', { purged });
  return purged;
}

/** Retención técnica diaria. Cada purga es independiente: si una falla, la otra corre igual. */
async function purgeTechnicalData(): Promise<void> {
  const results = await Promise.allSettled([purgeOperations(), purgeIdempotencyKeys()]);
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed.length > 0) {
    throw failed[0]!.reason;
  }
}

/**
 * Registra el cron mensual de retención de auditoría (RF-ADM-03 CA-3).
 * La purga del caliente la gobierna el Superadministrador vía la config global
 * `audit_hot_purge_enabled` (default false). Cuando está activa, el worker borra
 * de la BD los logs que superaron `audit_retention_hot_years` — la copia permanece
 * en S3 (frío). Con la config apagada (o ausente) solo avisa cuántos vencerán.
 */
function iniciar() {
  cron.schedule(RETENTION_CRON, () =>
    runOperation({ source: 'worker', name: 'audit-archive.retention' }, async () => {
      logger.info('Ejecutando worker: retención/archivado de auditoría');
      const config = await systemGlobalConfigRepository.findActive();
      await run({ enableDbPurge: config?.auditHotPurgeEnabled === true });
    })
  );
  cron.schedule(ARCHIVE_EXPORT_CRON, () =>
    runOperation({ source: 'worker', name: 'audit-archive.export' }, () => exportDay(new Date(Date.now() - MS_PER_DAY)))
  );
  cron.schedule(OPERATIONS_RETENTION_CRON, () =>
    runOperation({ source: 'worker', name: 'technical-data.retention' }, purgeTechnicalData)
  );
  logger.info('Worker de retención de auditoría iniciado exitosamente');
}

export default { run, exportDay, purgeOperations, purgeIdempotencyKeys, purgeTechnicalData, iniciar };
