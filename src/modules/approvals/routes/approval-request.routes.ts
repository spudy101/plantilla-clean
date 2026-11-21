import express from 'express';
import { validate } from '../../../shared/validation/validate';
import { ApprovalListQuery, ApprovalIdParams, ResolveApprovalBody } from '../requests/approval-request.request';
const router = express.Router();
import ApprovalRequestController from '../controllers/approval-request.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/http/request-lock.middleware';
import rbacModule from '../../../shared/constants/rbac';
const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

// ── GET /approval-requests/policy — ANTES de /:id para evitar colisión ───────
router.get(
  '/approval-requests/policy',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.DUAL_APPROVAL, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  ApprovalRequestController.getPolicy
);

// ── GET /approval-requests — listar ──────────────────────────────────────────
router.get(
  '/approval-requests',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.DUAL_APPROVAL, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: ApprovalListQuery }),
  ApprovalRequestController.list
);

// ── GET /approval-requests/:id — detalle ─────────────────────────────────────
router.get(
  '/approval-requests/:id',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.DUAL_APPROVAL, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: ApprovalIdParams }),
  ApprovalRequestController.getById
);

// ── POST /approval-requests/:id/resolve — aprobar / rechazar ─────────────────
// RBAC base APPROVALS.UPDATE; el service valida approverRoles del registro + segregación de funciones.
router.post(
  '/approval-requests/:id/resolve',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.DUAL_APPROVAL, RBAC_ACTIONS.UPDATE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: ApprovalIdParams, body: ResolveApprovalBody }),
  ApprovalRequestController.resolve
);

export default router;
