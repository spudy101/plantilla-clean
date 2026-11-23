// Composition root: el ÚNICO lugar de la aplicación donde se hacen los `new` y se conectan los módulos.
//
// Cada módulo en Clean Architecture expone una función create<Módulo>Module(deps). Acá se le pasan los
// adaptadores de los puertos que necesita (auditoría, notificaciones, logger, guardas HTTP) y se
// devuelve lo que la app monta (routers) o conecta a shared/ (fuentes de configuración).
//
// Los módulos que todavía no están migrados siguen cableándose solos (su index.ts); a medida que se migren
// se agregan acá y desaparecen sus singletons.
import loggerUtilModule from '../shared/infrastructure/observability/logger.util';
import { createSettingsModule } from '../modules/settings/settings.module';
import { createAuditModule } from '../modules/audit/audit.module';
import { auditSessionsAdapter, tracedEntitiesAdapter } from './adapters/audit-sources.adapter';
import type { SettingsModule } from '../modules/settings/settings.module';
import { notifierAdapter } from './adapters/notifier.adapter';
import { routeGuardsAdapter } from './adapters/route-guards.adapter';
import redisClient from '../shared/infrastructure/cache/redis.util';
import { createCatalogsModule } from '../modules/catalogs/catalogs.module';
import {
  notificationTypeCatalogAdapter,
  privacyPolicyCatalogAdapter,
  roleCatalogAdapter
} from './adapters/catalog-sources.adapter';
import localCache from '../shared/infrastructure/cache/cache.util';
import { uuidGenerator } from '../shared/infrastructure/ids/uuid-generator';
import { createBannersModule } from '../modules/banners/banners.module';
import { createLegalModule } from '../modules/legal/legal.module';
import { privacyPolicyCacheAdapter } from './adapters/privacy-policy-cache.adapter';
import unitOfWork from '../shared/infrastructure/database/unit-of-work';
import constantsModule from '../shared/infrastructure/config';
import { createIntegrationModule } from '../modules/integration/integration.module';
import { failedProcessCounterAdapter } from './adapters/failed-process-counter.adapter';

const { logger } = loggerUtilModule;

export function createContainer() {
  // audit va primero: su AuditTrail lo usan todos los demás. Su política de retención es de settings, que se
  // crea después; el lector la busca recién al usarse (cuando corre el worker).
  let settingsModule: SettingsModule | null = null;
  const audit = createAuditModule({
    logger,
    notifier: notifierAdapter,
    guards: routeGuardsAdapter,
    sessions: auditSessionsAdapter,
    tracedEntities: tracedEntitiesAdapter,
    retentionSettings: { read: () => (settingsModule ? settingsModule.useCases.getAuditRetention.execute() : Promise.resolve(null)) },
    operationsRetentionDays: constantsModule.logging.operationsRetentionDays,
    notificationLogoUrl: constantsModule.notifications.ses.logoUrl
  });

  const settings = createSettingsModule({
    audit: audit.trail,
    notifier: notifierAdapter,
    logger,
    guards: routeGuardsAdapter
  });

  const catalogs = createCatalogsModule({
    audit: audit.trail,
    cache: redisClient,
    roles: roleCatalogAdapter,
    notificationTypes: notificationTypeCatalogAdapter,
    privacyPolicies: privacyPolicyCatalogAdapter
  });

  const banners = createBannersModule({
    audit: audit.trail,
    logger,
    ids: uuidGenerator,
    cache: localCache,
    guards: routeGuardsAdapter
  });

  const legal = createLegalModule({
    audit: audit.trail,
    notifier: notifierAdapter,
    logger,
    unitOfWork,
    guards: routeGuardsAdapter,
    activePolicyCache: privacyPolicyCacheAdapter(redisClient),
    notificationLogoUrl: constantsModule.notifications.ses.logoUrl
  });

  const integration = createIntegrationModule({
    audit: audit.trail,
    logger,
    guards: routeGuardsAdapter,
    failedProcesses: failedProcessCounterAdapter
  });

  settingsModule = settings;

  return { audit, settings, catalogs, banners, legal, integration };
}

export type Container = ReturnType<typeof createContainer>;
