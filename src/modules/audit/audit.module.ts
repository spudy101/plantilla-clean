// Composición del módulo audit: el ÚNICO archivo del módulo que conoce todas sus capas.
//
//   Prisma (registros, alertas, bitácora, operaciones) + contexto de la operación + S3
//        ──► casos de uso ──► controllers ──► routers admin y client
//                   │
//                   ├──► trail: el puerto AuditTrail que usan todos los módulos (RecordAuditEvent)
//                   └──► worker de retención (cron)
//
// Lo que viene de afuera (sesiones de iam, filas de dominio de la traza, política de retención de settings,
// avisos, logger, guardas) llega por parámetro desde src/main/.
import type { Router } from 'express';
import type { AuditTrail } from '../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../shared/application/ports/logger.port';
import type { Notifier } from '../../shared/application/ports/notifier.port';
import type { RouteGuards } from '../../shared/presentation/http/route-guards';
import type { SessionDirectory } from './application/ports/session-directory.port';
import type { TracedEntityRegistry } from './application/ports/traced-entity-source.port';
import type { RetentionSettingsReader } from './application/ports/retention-settings.port';
import type { AccountChange } from './domain/account-change';
import { PrismaAuditLogRepository } from './infrastructure/persistence/prisma-audit-log.repository';
import { PrismaAuditAlertRepository } from './infrastructure/persistence/prisma-audit-alert.repository';
import { PrismaChangeLogRepository } from './infrastructure/persistence/prisma-change-log.repository';
import { PrismaOperationReader } from './infrastructure/persistence/prisma-operation.reader';
import { PrismaTechnicalDataRetention } from './infrastructure/persistence/prisma-technical-data.retention';
import { operationContextAdapter } from './infrastructure/context/operation-context.adapter';
import { s3AuditArchive } from './infrastructure/storage/s3-audit-archive';
import { createAuditRetentionWorker, type AuditRetentionWorker } from './infrastructure/workers/audit-retention.worker';
import { RecordAuditEvent } from './application/use-cases/record-audit-event.use-case';
import { RecordAccountChange } from './application/use-cases/record-account-change.use-case';
import { ListAuditLogs } from './application/use-cases/list-audit-logs.use-case';
import { GetAuditLog } from './application/use-cases/get-audit-log.use-case';
import { ExportAuditLogs } from './application/use-cases/export-audit-logs.use-case';
import { ListAuditAlerts } from './application/use-cases/list-audit-alerts.use-case';
import { AcknowledgeAuditAlert, AcknowledgeAuditAlerts } from './application/use-cases/acknowledge-audit-alerts.use-case';
import {
  GetAuditCategories,
  GetAuditModules,
  GetAuditRisks,
  ListAuditActions
} from './application/use-cases/audit-action-catalog.use-cases';
import { ListUserChangeLogs } from './application/use-cases/list-user-change-logs.use-case';
import { GetOperationTimeline, ListOperations } from './application/use-cases/operations.use-cases';
import { GetSessionEntities, GetSessionTimeline, ListSessionTraces } from './application/use-cases/session-trace.use-cases';
import { GetRecentActivity } from './application/use-cases/get-recent-activity.use-case';
import { ExportAuditDay, PurgeTechnicalData, RunAuditRetention } from './application/use-cases/retention.use-cases';
import {
  AuditActionCatalogController,
  AuditAlertController,
  AuditLogController,
  ChangeLogController,
  OperationController,
  SessionTraceController,
  UserActivityController
} from './presentation/http/audit.controllers';
import { createAuditAdminRouter, createAuditClientRouter } from './presentation/http/audit.routes';

export interface AuditModuleDeps {
  logger: Logger;
  notifier: Notifier;
  guards: RouteGuards;
  sessions: SessionDirectory;
  /** entity_table → cómo mostrar sus filas en la traza de sesión. */
  tracedEntities: TracedEntityRegistry;
  retentionSettings: RetentionSettingsReader;
  /** Días que se conserva la traza de operaciones. */
  operationsRetentionDays: number;
  notificationLogoUrl: string;
}

export interface AuditModule {
  adminRouter: Router;
  clientRouter: Router;
  /** El puerto AuditTrail para todos los módulos. */
  trail: AuditTrail;
  /** La bitácora de cambios de cuentas (iam, person). */
  recordAccountChange(change: AccountChange): Promise<void>;
  retentionWorker: AuditRetentionWorker;
}

export function createAuditModule(deps: AuditModuleDeps): AuditModule {
  const { logger, notifier, guards, sessions, tracedEntities, retentionSettings } = deps;

  const logs = new PrismaAuditLogRepository();
  const alerts = new PrismaAuditAlertRepository();
  const changes = new PrismaChangeLogRepository();
  const operations = new PrismaOperationReader();

  const recordEvent = new RecordAuditEvent(logs, alerts, operationContextAdapter, logger);
  const recordChange = new RecordAccountChange(recordEvent);
  const trail: AuditTrail = { record: (action, entry) => recordEvent.execute(action, entry) };

  const adminRouter = createAuditAdminRouter(
    {
      logs: new AuditLogController(new ListAuditLogs(logs, trail), new GetAuditLog(logs, trail), new ExportAuditLogs(logs, trail, logger)),
      alerts: new AuditAlertController(
        new ListAuditAlerts(alerts, trail),
        new AcknowledgeAuditAlert(alerts, trail, notifier, logger, deps.notificationLogoUrl),
        new AcknowledgeAuditAlerts(alerts, trail, notifier, logger, deps.notificationLogoUrl)
      ),
      catalog: new AuditActionCatalogController(
        new GetAuditCategories(trail),
        new GetAuditRisks(trail),
        new GetAuditModules(trail),
        new ListAuditActions(trail)
      ),
      changeLogs: new ChangeLogController(new ListUserChangeLogs(changes, trail)),
      operations: new OperationController(new ListOperations(operations, trail), new GetOperationTimeline(operations, logs, trail)),
      sessions: new SessionTraceController(
        new ListSessionTraces(sessions, logs, trail),
        new GetSessionTimeline(sessions, logs, tracedEntities, trail),
        new GetSessionEntities(sessions, logs, tracedEntities, trail)
      )
    },
    guards
  );
  const clientRouter = createAuditClientRouter(new UserActivityController(new GetRecentActivity(logs, changes, sessions, trail)), guards);

  const retentionWorker = createAuditRetentionWorker(
    {
      runRetention: new RunAuditRetention(logs, retentionSettings, trail, logger),
      exportDay: new ExportAuditDay(logs, s3AuditArchive, logger),
      purgeTechnicalData: new PurgeTechnicalData(new PrismaTechnicalDataRetention(), deps.operationsRetentionDays, logger)
    },
    logger
  );

  return {
    adminRouter,
    clientRouter,
    trail,
    recordAccountChange: change => recordChange.execute(change),
    retentionWorker
  };
}
