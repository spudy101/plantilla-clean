// Worker de retención de la auditoría (RF-ADM-03): programa con cron los casos de uso de retención. Cada
// corrida es su propia operación de worker. src/main/server.ts lo inicia junto con los demás workers.
//
//   día 1 de cada mes, 07:00   RunAuditRetention (aviso + purga si el Superadmin la activó)
//   cada día, 02:15 (UTC)      ExportAuditDay del día anterior completo
//   cada día, 03:30            PurgeTechnicalData (operaciones y claves de idempotencia vencidas)
import cron from 'node-cron';
import { runOperation } from '../../../../shared/infrastructure/observability/operation';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { ExportAuditDay, PurgeTechnicalData, RunAuditRetention } from '../../application/use-cases/retention.use-cases';

const RETENTION_CRON = '0 7 1 * *';
const ARCHIVE_EXPORT_CRON = '15 2 * * *';
const TECHNICAL_RETENTION_CRON = '30 3 * * *';
const MS_PER_DAY = 86_400_000;

export interface AuditRetentionWorker {
  start(): void;
}

export function createAuditRetentionWorker(
  { runRetention, exportDay, purgeTechnicalData }: { runRetention: RunAuditRetention; exportDay: ExportAuditDay; purgeTechnicalData: PurgeTechnicalData },
  logger: Logger
): AuditRetentionWorker {
  return {
    start() {
      cron.schedule(RETENTION_CRON, () =>
        runOperation({ source: 'worker', name: 'audit-archive.retention' }, async () => {
          logger.info('Ejecutando worker: retención/archivado de auditoría');
          await runRetention.executeScheduled();
        })
      );
      cron.schedule(ARCHIVE_EXPORT_CRON, () =>
        runOperation({ source: 'worker', name: 'audit-archive.export' }, () => exportDay.execute(new Date(Date.now() - MS_PER_DAY)))
      );
      cron.schedule(TECHNICAL_RETENTION_CRON, () =>
        runOperation({ source: 'worker', name: 'technical-data.retention' }, () => purgeTechnicalData.execute())
      );
      logger.info('Worker de retención de auditoría iniciado exitosamente');
    }
  };
}
