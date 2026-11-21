// Rutas del módulo legal. Cada router se arma con su controlador y las guardas que recibe: no importa el
// módulo iam.
//
//   admin  (/records): tipos de consentimiento, políticas de privacidad, consentimientos otorgados
//   client (/records): consentimientos del propio usuario
import express from 'express';
import type { Router } from 'express';
import { validate } from '../../../../shared/presentation/validation/validate';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';
import UploadMiddleware from '../../../../shared/presentation/http/upload.middleware';
import type { RouteGuards } from '../../../../shared/presentation/http/route-guards';
import rbacModule from '../../../../shared/domain/constants/rbac';
import {
  AdminUserConsentListQuery,
  ConsentHistoryQuery,
  ConsentTypeIdParams,
  ConsentTypeListQuery,
  CreateConsentTypeBody,
  CreatePrivacyPolicyBody,
  GrantConsentsBody,
  PrivacyPolicyFiles,
  PrivacyPolicyIdParams,
  PrivacyPolicyListQuery,
  RevokeConsentBody,
  UpdateConsentTypeBody,
  UserIdParams
} from './requests/legal.request';
import type { ConsentTypeController } from './consent-type.controller';
import type { PrivacyPolicyAdminController } from './privacy-policy-admin.controller';
import type { AdminUserConsentController } from './admin-user-consent.controller';
import type { UserConsentController } from './user-consent.controller';

const { RBAC_MODULES, RBAC_ACTIONS, RBAC_ROLES } = rbacModule;

/** Roles que pueden usar las rutas del portal cliente. */
const CLIENT_ACCESS_ROLES = [RBAC_ROLES.CLIENTE];

export interface LegalAdminControllers {
  consentTypes: ConsentTypeController;
  privacyPolicies: PrivacyPolicyAdminController;
  userConsents: AdminUserConsentController;
}

export function createLegalAdminRouter({ consentTypes, privacyPolicies, userConsents }: LegalAdminControllers, guards: RouteGuards): Router {
  const router = express.Router();
  const protect = (rbacModuleName: string, action: string) => [
    guards.authenticate,
    guards.requirePermission(rbacModuleName, action),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers()
  ];

  // ── Políticas de privacidad ──────────────────────────────────
  const policies = (action: string) => protect(RBAC_MODULES.PRIVACY_POLICIES, action);
  router.get('/legal/privacy-policies', ...policies(RBAC_ACTIONS.READ), validate({ query: PrivacyPolicyListQuery }), privacyPolicies.listVersions);
  router.get(
    '/legal/privacy-policies/:privacyPolicyId',
    ...policies(RBAC_ACTIONS.READ),
    validate({ params: PrivacyPolicyIdParams }),
    privacyPolicies.getVersionDetail
  );
  router.post(
    '/legal/privacy-policies',
    ...policies(RBAC_ACTIONS.CREATE),
    UploadMiddleware.uploadFields([{ name: 'policyDocument', maxCount: 1 }], { maxFileSize: UploadMiddleware.MAX_DOCUMENT_SIZE }),
    UploadMiddleware.handleMulterError,
    validate({ body: CreatePrivacyPolicyBody, files: PrivacyPolicyFiles }),
    privacyPolicies.createVersion
  );

  // ── Tipos de consentimiento ──────────────────────────────────
  const types = (action: string) => protect(RBAC_MODULES.CONSENT_TYPES, action);
  router.get('/legal/consent-types', ...types(RBAC_ACTIONS.READ), validate({ query: ConsentTypeListQuery }), consentTypes.list);
  router.get('/legal/consent-types/:consentTypeId', ...types(RBAC_ACTIONS.READ), validate({ params: ConsentTypeIdParams }), consentTypes.getById);
  router.post('/legal/consent-types', ...types(RBAC_ACTIONS.CREATE), validate({ body: CreateConsentTypeBody }), consentTypes.create);
  router.patch(
    '/legal/consent-types/:consentTypeId',
    ...types(RBAC_ACTIONS.UPDATE),
    validate({ params: ConsentTypeIdParams, body: UpdateConsentTypeBody }),
    consentTypes.update
  );

  // ── Consentimientos otorgados ────────────────────────────────
  const acceptance = (action: string) => protect(RBAC_MODULES.POLICY_ACCEPTANCE, action);
  router.get('/legal/user-consents', ...acceptance(RBAC_ACTIONS.READ), validate({ query: AdminUserConsentListQuery }), userConsents.list);
  router.get(
    '/legal/user-consents/users/:userId',
    ...acceptance(RBAC_ACTIONS.READ),
    validate({ params: UserIdParams, query: ConsentHistoryQuery }),
    userConsents.getHistoryByUser
  );

  return router;
}

export function createLegalClientRouter(controller: UserConsentController, guards: RouteGuards): Router {
  const router = express.Router();
  const client = guards.requireRole(CLIENT_ACCESS_ROLES);

  router.get('/legal/consents', client, RateLimitMiddleware.apiLimiter(), controller.getMyConsents);
  router.post(
    '/legal/consents/grant',
    client,
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ body: GrantConsentsBody }),
    controller.grant
  );
  router.post(
    '/legal/consents/:consentTypeId/revoke',
    client,
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ params: ConsentTypeIdParams, body: RevokeConsentBody }),
    controller.revokeMarketing
  );

  return router;
}
