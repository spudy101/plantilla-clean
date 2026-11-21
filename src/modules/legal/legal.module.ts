// Composición del módulo legal: el ÚNICO archivo del módulo que conoce todas sus capas.
//
//   Prisma (tipos, políticas, consentimientos) + S3 (PDF) ──► casos de uso ──► controllers ──► routers
//
// Lo que viene de afuera (auditoría, avisos, logger, transacciones, guardas, la caché de la política que lee
// catalogs) llega por parámetro desde src/main/. Legal no importa ningún otro módulo.
import type { Router } from 'express';
import type { AuditTrail } from '../../shared/application/ports/audit-trail.port';
import type { Notifier } from '../../shared/application/ports/notifier.port';
import type { Logger } from '../../shared/application/ports/logger.port';
import type { UnitOfWork } from '../../shared/application/ports/unit-of-work.port';
import type { RouteGuards } from '../../shared/presentation/http/route-guards';
import type { ActivePrivacyPolicyCache } from './application/ports/active-privacy-policy-cache.port';
import { PrismaConsentTypeRepository } from './infrastructure/persistence/prisma-consent-type.repository';
import { PrismaPrivacyPolicyRepository } from './infrastructure/persistence/prisma-privacy-policy.repository';
import { PrismaUserConsentRepository } from './infrastructure/persistence/prisma-user-consent.repository';
import { S3PolicyDocumentStorage } from './infrastructure/storage/s3-policy-document.storage';
import { ListConsentTypes } from './application/use-cases/list-consent-types.use-case';
import { GetConsentType } from './application/use-cases/get-consent-type.use-case';
import { CreateConsentType } from './application/use-cases/create-consent-type.use-case';
import { UpdateConsentType } from './application/use-cases/update-consent-type.use-case';
import { ListPrivacyPolicies } from './application/use-cases/list-privacy-policies.use-case';
import { GetPrivacyPolicy } from './application/use-cases/get-privacy-policy.use-case';
import { PublishPrivacyPolicy } from './application/use-cases/publish-privacy-policy.use-case';
import { ListMyConsents } from './application/use-cases/list-my-consents.use-case';
import { GrantConsents } from './application/use-cases/grant-consents.use-case';
import { RevokeConsent } from './application/use-cases/revoke-consent.use-case';
import { ListUserConsents } from './application/use-cases/list-user-consents.use-case';
import { GetUserConsentHistory } from './application/use-cases/get-user-consent-history.use-case';
import { VerifyConsent } from './application/use-cases/verify-consent.use-case';
import { GrantPrivacyPolicyConsent } from './application/use-cases/grant-privacy-policy-consent.use-case';
import { GrantCommercialCommunicationsConsent } from './application/use-cases/grant-commercial-communications-consent.use-case';
import { ConsentTypeController } from './presentation/http/consent-type.controller';
import { PrivacyPolicyAdminController } from './presentation/http/privacy-policy-admin.controller';
import { AdminUserConsentController } from './presentation/http/admin-user-consent.controller';
import { UserConsentController } from './presentation/http/user-consent.controller';
import { createLegalAdminRouter, createLegalClientRouter } from './presentation/http/legal.routes';
import { createRequireConsent, type RequireConsent } from './presentation/http/require-consent.middleware';

export interface LegalModuleDeps {
  audit: AuditTrail;
  notifier: Notifier;
  logger: Logger;
  unitOfWork: UnitOfWork;
  guards: RouteGuards;
  /** La copia en caché de la política vigente (la lee catalogs): se invalida al publicar una versión. */
  activePolicyCache: ActivePrivacyPolicyCache;
  /** Logo de las plantillas de correo de los avisos a administradores. */
  notificationLogoUrl: string | null | undefined;
}

export interface LegalModule {
  adminRouter: Router;
  clientRouter: Router;
  /** Middleware para exigir un consentimiento obligatorio vigente en una ruta. */
  requireConsent: RequireConsent;
  /** Lo que usan otros módulos (registro y login dejan constancia de lo que aceptó el usuario). */
  useCases: {
    grantPrivacyPolicyConsent: GrantPrivacyPolicyConsent;
    grantCommercialCommunicationsConsent: GrantCommercialCommunicationsConsent;
  };
}

/** Los casos de uso que otros módulos usan para dejar constancia de un consentimiento. */
export function createConsentRecorders(
  consentTypes = new PrismaConsentTypeRepository(),
  userConsents = new PrismaUserConsentRepository(),
  policies = new PrismaPrivacyPolicyRepository()
) {
  return {
    grantPrivacyPolicyConsent: new GrantPrivacyPolicyConsent(consentTypes, userConsents, policies),
    grantCommercialCommunicationsConsent: new GrantCommercialCommunicationsConsent(consentTypes, userConsents)
  };
}

export function createLegalModule(deps: LegalModuleDeps): LegalModule {
  const { audit, notifier, logger, unitOfWork, guards, activePolicyCache, notificationLogoUrl } = deps;
  const consentTypes = new PrismaConsentTypeRepository();
  const policies = new PrismaPrivacyPolicyRepository();
  const userConsents = new PrismaUserConsentRepository();
  const notice = { notifier, logger, logoUrl: notificationLogoUrl };

  const consentTypeController = new ConsentTypeController(
    new ListConsentTypes(consentTypes, audit),
    new GetConsentType(consentTypes, audit),
    new CreateConsentType(consentTypes, audit, logger, notice),
    new UpdateConsentType(consentTypes, audit, notice)
  );
  const privacyPolicyController = new PrivacyPolicyAdminController(
    new ListPrivacyPolicies(policies, audit),
    new GetPrivacyPolicy(policies, audit),
    new PublishPrivacyPolicy(policies, new S3PolicyDocumentStorage(), activePolicyCache, audit, notifier, logger)
  );
  const adminUserConsentController = new AdminUserConsentController(
    new ListUserConsents(userConsents, audit),
    new GetUserConsentHistory(userConsents, audit)
  );
  const userConsentController = new UserConsentController(
    new ListMyConsents(consentTypes, userConsents, audit),
    new GrantConsents(unitOfWork, consentTypes, userConsents, audit, logger),
    new RevokeConsent(unitOfWork, consentTypes, userConsents, audit, logger)
  );

  return {
    adminRouter: createLegalAdminRouter(
      { consentTypes: consentTypeController, privacyPolicies: privacyPolicyController, userConsents: adminUserConsentController },
      guards
    ),
    clientRouter: createLegalClientRouter(userConsentController, guards),
    requireConsent: createRequireConsent(new VerifyConsent(consentTypes, userConsents, audit, logger)),
    useCases: createConsentRecorders(consentTypes, userConsents, policies)
  };
}
