// Rutas admin de la doble aprobación (RBAC: módulo dualApproval). El router se arma con el controlador y las
// guardas que recibe: no importa el módulo iam.
import express from 'express';
import type { Router } from 'express';
import { validate } from '../../../../shared/presentation/validation/validate';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';
import type { RouteGuards } from '../../../../shared/presentation/http/route-guards';
import rbacModule from '../../../../shared/domain/constants/rbac';
import { ApprovalIdParams, ApprovalListQuery, ResolveApprovalBody } from './requests/approval-request.request';
import type { ApprovalRequestController } from './approval-request.controller';

const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

export function createApprovalRequestRouter(controller: ApprovalRequestController, guards: RouteGuards): Router {
  const router = express.Router();
  const protect = (action: string) => [
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.DUAL_APPROVAL, action),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers()
  ];

  // GET /approval-requests/policy — ANTES de /:id para que no colisione
  router.get('/approval-requests/policy', ...protect(RBAC_ACTIONS.READ), controller.getPolicy);

  // GET /approval-requests — la cola, con filtros
  router.get('/approval-requests', ...protect(RBAC_ACTIONS.READ), validate({ query: ApprovalListQuery }), controller.list);

  // GET /approval-requests/:id — detalle
  router.get('/approval-requests/:id', ...protect(RBAC_ACTIONS.READ), validate({ params: ApprovalIdParams }), controller.getById);

  // POST /approval-requests/:id/resolve — aprobar / rechazar. El RBAC es la base; el caso de uso valida además los
  // roles aprobadores de la operación y la segregación de funciones.
  router.post(
    '/approval-requests/:id/resolve',
    ...protect(RBAC_ACTIONS.UPDATE),
    validate({ params: ApprovalIdParams, body: ResolveApprovalBody }),
    controller.resolve
  );

  return router;
}
