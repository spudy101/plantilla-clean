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
import { externalGuardsAdapter, routeGuardsAdapter } from './adapters/route-guards.adapter';
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
import { createPersonModule } from '../modules/person/person.module';
import {
  clientAccountsAdapter,
  contactVerificationsAdapter,
  dualApprovalGateAdapter,
  profileCatalogsAdapter,
  profileConsentsAdapter,
  roleDirectoryAdapter
} from './adapters/person-sources.adapter';
import approvalsModule from '../modules/approvals';
import { createNotificationModule } from '../modules/notification/notification.module';
import { phonePrefixesAdapter, recipientDirectoryAdapter } from './adapters/notification-sources.adapter';

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

  // notification va segundo: los demás avisan por su Notifier (notifierAdapter lo busca al usarse)
  const notification = createNotificationModule({
    audit: audit.trail,
    logger,
    unitOfWork,
    guards: routeGuardsAdapter,
    externalGuards: externalGuardsAdapter,
    recipients: recipientDirectoryAdapter,
    phonePrefixes: phonePrefixesAdapter,
    notificationLogoUrl: constantsModule.notifications.ses.logoUrl,
    mockProviders: constantsModule.MOCKS.EXTERNAL_PROVIDERS,
    bounceTopicArn: constantsModule.notifications.sns.bounceTopicArn
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

  const person = createPersonModule({
    audit: audit.trail,
    changeLog: { record: change => audit.recordAccountChange(change) },
    notifier: notifierAdapter,
    logger,
    unitOfWork,
    ids: uuidGenerator,
    guards: routeGuardsAdapter,
    accounts: clientAccountsAdapter,
    roles: roleDirectoryAdapter,
    catalogs: profileCatalogsAdapter,
    verifications: contactVerificationsAdapter,
    consents: profileConsentsAdapter,
    approvals: dualApprovalGateAdapter,
    notificationLogoUrl: constantsModule.notifications.ses.logoUrl
  });
  // La baja de una cuenta de cliente queda pendiente de una segunda aprobación: approvals la reanuda con esto
  approvalsModule.DualApprovalService.register('CLIENT_ACCOUNT_DELETE', (payload: { userId: string }, ctx) =>
    person.useCases.executeClientAccountDeletion.execute({ userId: payload.userId, ctx })
  );

  settingsModule = settings;

  return { audit, notification, settings, catalogs, banners, legal, integration, person };
}

export type Container = ReturnType<typeof createContainer>;
