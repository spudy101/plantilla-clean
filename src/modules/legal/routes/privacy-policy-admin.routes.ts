// modules/admin/privacy-policy/routes/privacy-policy-admin.routes.ts

import express from 'express';
import { validate } from '../../../shared/presentation/validation/validate';
import { PrivacyPolicyListQuery, PrivacyPolicyIdParams, CreatePrivacyPolicyBody, PrivacyPolicyFiles } from '../requests/legal.request';
const router = express.Router();
import PrivacyPolicyAdminController from '../controllers/privacy-policy-admin.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/presentation/http/request-lock.middleware';
import UploadMiddleware from '../../../shared/presentation/http/upload.middleware';
import rbacModule from '../../../shared/domain/constants/rbac';
const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

/**
 * GET /admin/api/privacy-policies
 * Lista paginada de versiones de política de privacidad.
 */
router.get(
  '/legal/privacy-policies',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.PRIVACY_POLICIES, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: PrivacyPolicyListQuery }),
  PrivacyPolicyAdminController.listVersions
);

/**
 * GET /admin/api/privacy-policies/:privacyPolicyId
 * Detalle de una versión — incluye document_url (URL pública del PDF en CloudFront).
 */
router.get(
  '/legal/privacy-policies/:privacyPolicyId',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.PRIVACY_POLICIES, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: PrivacyPolicyIdParams }),
  PrivacyPolicyAdminController.getVersionDetail
);

/**
 * POST /admin/api/privacy-policies
 * Publica una nueva versión de la política.
 * Content-Type: multipart/form-data
 *
 * Body:
 *   policyDocument  (PDF, requerido)    — campo del archivo
 *   version         (string, requerido) — ej: "1.1", "2.0"
 *   summary         (string, opcional)  — resumen de cambios
 *   effectiveDate   (ISO 8601, opcional) — fecha de vigencia (default: ahora)
 */
router.post(
  '/legal/privacy-policies',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.PRIVACY_POLICIES, RBAC_ACTIONS.CREATE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  UploadMiddleware.uploadFields([{ name: 'policyDocument', maxCount: 1 }], {
    maxFileSize: UploadMiddleware.MAX_DOCUMENT_SIZE
  }),
  UploadMiddleware.handleMulterError,
  validate({ body: CreatePrivacyPolicyBody, files: PrivacyPolicyFiles }),
  PrivacyPolicyAdminController.createVersion
);

export default router;
