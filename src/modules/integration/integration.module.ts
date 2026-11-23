// Composición del módulo integration: el ÚNICO archivo del módulo que conoce todas sus capas.
//
//   Prisma (ventanas) + circuit breaker (estado) ──► casos de uso ──► controller ──► router admin
//                                                         ▲
//   circuit breaker: onOpen / onClose ── listener ────────┘
//
// Lo que viene de afuera (auditoría, logger, guardas, procesos fallidos de otros módulos) llega por
// parámetro desde src/main/.
import type { Router } from 'express';
import type { AuditTrail } from '../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../shared/application/ports/logger.port';
import type { RouteGuards } from '../../shared/presentation/http/route-guards';
import type { FailedProcessCounter } from './application/ports/failed-process-counter.port';
import { PrismaFallbackEventRepository } from './infrastructure/persistence/prisma-fallback-event.repository';
import { CircuitBreakerStatusReader } from './infrastructure/circuit-breaker/circuit-breaker-status.reader';
import { createFallbackCircuitListener, type CircuitBreakerListener } from './infrastructure/circuit-breaker/fallback-circuit.listener';
import { GetProvidersHealth } from './application/use-cases/get-providers-health.use-case';
import { ListFallbackHistory } from './application/use-cases/list-fallback-history.use-case';
import { RecordFallbackOpened } from './application/use-cases/record-fallback-opened.use-case';
import { RecordFallbackResolved } from './application/use-cases/record-fallback-resolved.use-case';
import { IntegrationMonitoringController } from './presentation/http/integration-monitoring.controller';
import { createIntegrationMonitoringRouter } from './presentation/http/integration-monitoring.routes';

export interface IntegrationModuleDeps {
  audit: AuditTrail;
  logger: Logger;
  guards: RouteGuards;
  /** Cuántos procesos fallaron durante una caída (los intentos son de otros módulos). */
  failedProcesses: FailedProcessCounter;
}

export interface IntegrationModule {
  adminRouter: Router;
  /** onOpen/onClose para CircuitBreaker.registerCallbacks (lo conecta src/main/app.ts). */
  circuitListener: CircuitBreakerListener;
}

export function createIntegrationModule({ audit, logger, guards, failedProcesses }: IntegrationModuleDeps): IntegrationModule {
  const fallbacks = new PrismaFallbackEventRepository();
  const circuits = new CircuitBreakerStatusReader();

  const controller = new IntegrationMonitoringController(
    new GetProvidersHealth(circuits, fallbacks, audit),
    new ListFallbackHistory(fallbacks, audit)
  );

  const circuitListener = createFallbackCircuitListener(
    {
      recordOpened: new RecordFallbackOpened(fallbacks, audit, logger),
      recordResolved: new RecordFallbackResolved(fallbacks, failedProcesses, audit, logger)
    },
    logger
  );

  return { adminRouter: createIntegrationMonitoringRouter(controller, guards), circuitListener };
}
