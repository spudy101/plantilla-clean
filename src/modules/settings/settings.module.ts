// Composición del módulo settings: el ÚNICO archivo del módulo que conoce todas sus capas.
//
// Crea los adaptadores (Prisma), se los pasa a los casos de uso y los casos de uso al controlador. Lo que
// viene de otros módulos (auditoría, notificaciones, guardas de las rutas) llega por parámetro desde
// src/main/container.ts: settings no importa ningún otro módulo.
//
//   infraestructura ──► casos de uso ──► controlador ──► router
//        (Prisma)        (puertos)          (HTTP)
import type { Router } from 'express';
import type { AuditTrail } from '../../shared/application/ports/audit-trail.port';
import type { Notifier } from '../../shared/application/ports/notifier.port';
import type { Logger } from '../../shared/application/ports/logger.port';
import type { RouteGuards } from '../../shared/presentation/http/route-guards';
import { PrismaSystemGlobalConfigRepository } from './infrastructure/persistence/prisma-system-global-config.repository';
import { GetSystemGlobalConfig } from './application/use-cases/get-system-global-config.use-case';
import { UpdateSystemGlobalConfig } from './application/use-cases/update-system-global-config.use-case';
import { GetIntegrationResilience } from './application/use-cases/get-integration-resilience.use-case';
import { GetAuditRetention } from './application/use-cases/get-audit-retention.use-case';
import { SystemGlobalConfigController } from './presentation/http/system-global-config.controller';
import { createSystemGlobalConfigRouter } from './presentation/http/system-global-config.routes';

export interface SettingsModuleDeps {
  audit: AuditTrail;
  notifier: Notifier;
  logger: Logger;
  guards: RouteGuards;
}

export interface SettingsModule {
  /** Rutas de administración (se montan bajo /admin/api/v1/core). */
  adminRouter: Router;
  useCases: {
    getSystemGlobalConfig: GetSystemGlobalConfig;
    updateSystemGlobalConfig: UpdateSystemGlobalConfig;
    getIntegrationResilience: GetIntegrationResilience;
    getAuditRetention: GetAuditRetention;
  };
}

export function createSettingsModule({ audit, notifier, logger, guards }: SettingsModuleDeps): SettingsModule {
  const configs = new PrismaSystemGlobalConfigRepository();

  const getSystemGlobalConfig = new GetSystemGlobalConfig(configs, audit);
  const updateSystemGlobalConfig = new UpdateSystemGlobalConfig(configs, audit, notifier, logger);
  const getIntegrationResilience = new GetIntegrationResilience(configs);
  const getAuditRetention = new GetAuditRetention(configs);

  const controller = new SystemGlobalConfigController(getSystemGlobalConfig, updateSystemGlobalConfig);

  return {
    adminRouter: createSystemGlobalConfigRouter(controller, guards),
    useCases: { getSystemGlobalConfig, updateSystemGlobalConfig, getIntegrationResilience, getAuditRetention }
  };
}
