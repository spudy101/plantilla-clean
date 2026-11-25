// Composition root: el ÚNICO lugar de la aplicación donde se hacen los `new` y se conectan los módulos.
//
// Cada módulo expone una función create<Módulo>Module(deps). Acá se le pasan los adaptadores de los puertos que
// necesita (auditoría, notificaciones, logger, guardas HTTP, lo de otros módulos) y se devuelve lo que la app monta
// (routers), lo que server.ts arranca (workers) y lo que se conecta a shared/ (fuentes de configuración).
//
// Los módulos se necesitan entre sí, así que los adaptadores de src/main/adapters/ leen el registro de módulos al
// usarse (ver module-registry.ts): el orden de abajo solo importa para quien USA algo de otro al armarse.
import type { AuditTrail } from '../shared/application/ports/audit-trail.port';
import type { EmailNotifier, Notifier } from '../shared/application/ports/notifier.port';
import type { RouteGuards } from '../shared/presentation/http/route-guards';
import loggerUtilModule from '../shared/infrastructure/observability/logger.util';
import redisClient from '../shared/infrastructure/cache/redis.util';
import localCache from '../shared/infrastructure/cache/cache.util';
import { uuidGenerator } from '../shared/infrastructure/ids/uuid-generator';
import unitOfWork from '../shared/infrastructure/database/unit-of-work';
import constantsModule from '../shared/infrastructure/config';
import { createIamModule } from '../modules/iam/iam.module';
import type { IamPolicy } from '../modules/iam/application/use-cases/iam-deps';
import { createAuditModule } from '../modules/audit/audit.module';
import { createNotificationModule } from '../modules/notification/notification.module';
import { createSettingsModule } from '../modules/settings/settings.module';
import { createCatalogsModule } from '../modules/catalogs/catalogs.module';
import { createBannersModule } from '../modules/banners/banners.module';
import { createLegalModule } from '../modules/legal/legal.module';
import { createIntegrationModule } from '../modules/integration/integration.module';
import { createApprovalsModule } from '../modules/approvals/approvals.module';
import { createPersonModule } from '../modules/person/person.module';
import { createModuleRegistry, type ModuleRegistry, type Modules } from './adapters/module-registry';
import { externalGuardsAdapter, routeGuardsAdapter } from './adapters/route-guards.adapter';
import { notifierAdapter } from './adapters/notifier.adapter';
import { iamSourcesAdapter } from './adapters/iam-sources.adapter';
import { auditSessionsAdapter, tracedEntitiesAdapter } from './adapters/audit-sources.adapter';
import { notificationTypeCatalogAdapter, privacyPolicyCatalogAdapter, roleCatalogAdapter } from './adapters/catalog-sources.adapter';
import { privacyPolicyCacheAdapter } from './adapters/privacy-policy-cache.adapter';
import { failedProcessCounterAdapter } from './adapters/failed-process-counter.adapter';
import { phonePrefixesAdapter, recipientDirectoryAdapter } from './adapters/notification-sources.adapter';
import { approvalThresholdsAdapter, approverDirectoryAdapter, iamApprovalHandlers } from './adapters/approval-sources.adapter';
import {
  clientAccountsAdapter,
  contactVerificationsAdapter,
  dualApprovalGateAdapter,
  profileCatalogsAdapter,
  profileConsentsAdapter,
  roleDirectoryAdapter
} from './adapters/person-sources.adapter';

const { logger } = loggerUtilModule;
const { SECURITY, LOGIN_RATE_LIMIT, MOCKS, frontend, server, notifications } = constantsModule;
const notificationLogoUrl = notifications.ses.logoUrl;

/** Lo que reciben casi todos los módulos. */
interface Shared {
  modules: ModuleRegistry;
  register: <K extends keyof Modules>(name: K, module: Modules[K]) => Modules[K];
  guards: RouteGuards;
  notifier: Notifier & EmailNotifier;
}

/** La política de seguridad de iam (la fija la configuración). */
function iamPolicy(): IamPolicy {
  return {
    session: {
      maxActiveSessions: SECURITY.MAX_ACTIVE_SESSIONS,
      inactivityMinutes: SECURITY.SESSION_INACTIVITY_MINUTES,
      accessThrottleSeconds: SECURITY.SESSION_ACCESS_THROTTLE_SECONDS,
      absoluteLifetimeHours: SECURITY.ABSOLUTE_SESSION_LIFETIME_HOURS
    },
    maxAccountAttempts: LOGIN_RATE_LIMIT.ACCOUNT_MAX_ATTEMPTS,
    resetTokenMinutes: SECURITY.RESET_TOKEN_EXPIRATION_MINUTES,
    resetCredentialUrl: frontend.resetCredentialUrl,
    mockOtpCodes: MOCKS.EXTERNAL_PROVIDERS,
    requireMobileSignature: server.nodeEnv === 'production',
    notificationLogoUrl
  };
}

/** iam, audit y notification: lo que usan todos los demás (las guardas, la auditoría, los avisos). */
function createFoundation({ modules, register, guards, notifier }: Shared) {
  // El AuditTrail de todos: el de audit, buscado al usarse (iam se arma antes que audit)
  const audit: AuditTrail = { record: (action, entry) => modules.audit.trail.record(action, entry) };

  // iam va primero: sus guardas protegen las rutas de todos los módulos
  const iam = register('iam', createIamModule({ policy: iamPolicy(), audit, logger, notifier, unitOfWork, ...iamSourcesAdapter(modules) }));

  // La política de retención de audit es de settings, que se crea después: el lector la busca al usarse (el worker)
  const auditModule = register(
    'audit',
    createAuditModule({
      logger,
      notifier,
      guards,
      sessions: auditSessionsAdapter(modules),
      tracedEntities: tracedEntitiesAdapter(modules),
      retentionSettings: { read: () => modules.settings.useCases.getAuditRetention.execute() },
      operationsRetentionDays: constantsModule.logging.operationsRetentionDays,
      notificationLogoUrl
    })
  );

  const notification = register(
    'notification',
    createNotificationModule({
      audit: auditModule.trail,
      logger,
      unitOfWork,
      guards,
      externalGuards: externalGuardsAdapter(modules),
      recipients: recipientDirectoryAdapter(modules),
      phonePrefixes: phonePrefixesAdapter(modules),
      notificationLogoUrl,
      mockProviders: MOCKS.EXTERNAL_PROVIDERS,
      bounceTopicArn: notifications.sns.bounceTopicArn
    })
  );

  return { iam, audit: auditModule, notification };
}

/** Configuración, catálogos, contenido, legal e integraciones. */
function createPlatform({ modules, register, guards, notifier }: Shared, audit: AuditTrail) {
  const settings = register('settings', createSettingsModule({ audit, notifier, logger, guards }));
  const catalogs = register(
    'catalogs',
    createCatalogsModule({
      audit,
      cache: redisClient,
      roles: roleCatalogAdapter(modules),
      notificationTypes: notificationTypeCatalogAdapter(modules),
      privacyPolicies: privacyPolicyCatalogAdapter(modules)
    })
  );
  const banners = createBannersModule({ audit, logger, ids: uuidGenerator, cache: localCache, guards });
  const legal = register(
    'legal',
    createLegalModule({ audit, notifier, logger, unitOfWork, guards, activePolicyCache: privacyPolicyCacheAdapter(redisClient), notificationLogoUrl })
  );
  const integration = createIntegrationModule({ audit, logger, guards, failedProcesses: failedProcessCounterAdapter(modules) });
  return { settings, catalogs, banners, legal, integration };
}

/** La doble aprobación y las personas detrás de las cuentas, con las reanudaciones de las operaciones gateadas. */
function createAccounts({ modules, register, guards, notifier }: Shared, audit: AuditTrail, recordAccountChange: Modules['audit']['recordAccountChange']) {
  const approvals = register(
    'approvals',
    createApprovalsModule({
      audit,
      notifier,
      logger,
      guards,
      approvers: approverDirectoryAdapter(modules),
      thresholds: approvalThresholdsAdapter,
      notificationLogoUrl
    })
  );

  const person = register(
    'person',
    createPersonModule({
      audit,
      changeLog: { record: change => recordAccountChange(change) },
      notifier,
      logger,
      unitOfWork,
      ids: uuidGenerator,
      guards,
      accounts: clientAccountsAdapter(modules),
      roles: roleDirectoryAdapter(modules),
      catalogs: profileCatalogsAdapter(modules),
      verifications: contactVerificationsAdapter(modules),
      consents: profileConsentsAdapter(modules),
      approvals: dualApprovalGateAdapter(modules),
      notificationLogoUrl
    })
  );

  // Lo que ejecuta approvals cuando el segundo funcionario aprueba
  approvals.handlers.register('CLIENT_ACCOUNT_DELETE', (payload: { userId: string }, ctx) =>
    person.useCases.executeClientAccountDeletion.execute({ userId: payload.userId, ctx })
  );
  for (const [operationKey, onApprove] of Object.entries(iamApprovalHandlers(modules.iam))) {
    approvals.handlers.register(operationKey, onApprove);
  }

  return { approvals, person };
}

export function createContainer() {
  const { modules, register } = createModuleRegistry();
  const shared: Shared = { modules, register, guards: routeGuardsAdapter(modules), notifier: notifierAdapter(modules) };

  const foundation = createFoundation(shared);
  const { trail, recordAccountChange } = foundation.audit;
  const platform = createPlatform(shared, trail);
  const accounts = createAccounts(shared, trail, change => recordAccountChange(change));

  return { ...foundation, ...platform, ...accounts };
}

export type Container = ReturnType<typeof createContainer>;
