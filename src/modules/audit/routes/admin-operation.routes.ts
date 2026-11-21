// Traza de operaciones (admin, solo lectura). Mismo permiso RBAC que los logs de auditoría (GLOBAL_LOGS).
import express from 'express';
import { validate } from '../../../shared/validation/validate';
import { OperationListQuery, OperationIdParams } from '../requests/audit.request';
const router = express.Router();
import AdminOperationController from '../controllers/admin-operation.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/http/request-lock.middleware';
import constantsModule from '../../../shared/constants';
const { RBAC_MODULES, RBAC_ACTIONS } = constantsModule;

const guards = [
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.GLOBAL_LOGS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers()
];

router.get('/audit/operations', ...guards, validate({ query: OperationListQuery }), AdminOperationController.list);

router.get(
  '/audit/operations/:operationId',
  ...guards,
  validate({ params: OperationIdParams }),
  AdminOperationController.timeline
);

export default router;
