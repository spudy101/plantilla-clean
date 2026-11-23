// Rutas de audit. Los routers se arman con los controladores y las guardas que reciben: no importan iam.
//
//   admin (montado en /api/v1/records)   logs, alertas, catálogo de acciones, bitácora de cambios,
//                                        sesiones y operaciones — permisos RBAC por recurso
//   client (montado en /api/v1/records)  actividad reciente del propio usuario
import express from 'express';
import type { RequestHandler, Router } from 'express';
import { validate } from '../../../../shared/presentation/validation/validate';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';
import type { RouteGuards } from '../../../../shared/presentation/http/route-guards';
import rbacModule from '../../../../shared/domain/constants/rbac';
import {
  AcknowledgeAlertsBody,
  AuditActionListQuery,
  AuditAlertIdParams,
  AuditAlertListQuery,
  AuditLogExportQuery,
  AuditLogIdParams,
  AuditLogListQuery,
  ChangeLogListQuery,
  OperationIdParams,
  OperationListQuery,
  RecentActivityQuery,
  SessionEntitiesQuery,
  SessionIdParams,
  SessionListQuery,
  SessionTimelineQuery
} from './requests/audit.request';
import type {
  AuditActionCatalogController,
  AuditAlertController,
  AuditLogController,
  ChangeLogController,
  OperationController,
  SessionTraceController,
  UserActivityController
} from './audit.controllers';

const { RBAC_MODULES, RBAC_ACTIONS, RBAC_ROLES } = rbacModule;
const CLIENT_ACCESS_ROLES = [RBAC_ROLES.CLIENTE];

export interface AuditAdminControllers {
  logs: AuditLogController;
  alerts: AuditAlertController;
  catalog: AuditActionCatalogController;
  changeLogs: ChangeLogController;
  operations: OperationController;
  sessions: SessionTraceController;
}

export function createAuditAdminRouter(c: AuditAdminControllers, guards: RouteGuards): Router {
  const router = express.Router();
  const protect = (rbacModuleName: string, action: string, { lock = true } = {}): RequestHandler[] => [
    guards.authenticate,
    guards.requirePermission(rbacModuleName, action),
    RateLimitMiddleware.apiLimiter(),
    ...(lock ? [RequestLockMiddleware.forAuthenticatedUsers()] : [])
  ];
  const { READ, UPDATE } = RBAC_ACTIONS;

  // Logs de auditoría (la exportación es un stream largo: sin request lock)
  router.get('/audit/audit-logs', ...protect(RBAC_MODULES.GLOBAL_LOGS, READ), validate({ query: AuditLogListQuery }), c.logs.list);
  router.get(
    '/audit/audit-logs/export',
    ...protect(RBAC_MODULES.GLOBAL_LOGS, READ, { lock: false }),
    validate({ query: AuditLogExportQuery }),
    c.logs.export
  );
  router.get('/audit/audit-logs/:auditLogId', ...protect(RBAC_MODULES.GLOBAL_LOGS, READ), validate({ params: AuditLogIdParams }), c.logs.getById);

  // Alertas
  router.get('/audit/audit-alerts', ...protect(RBAC_MODULES.SYSTEM_ALERTS, READ), validate({ query: AuditAlertListQuery }), c.alerts.list);
  router.patch(
    '/audit/audit-alerts/:alertId/acknowledge',
    ...protect(RBAC_MODULES.SYSTEM_ALERTS, UPDATE),
    validate({ params: AuditAlertIdParams }),
    c.alerts.acknowledge
  );
  router.post(
    '/audit/audit-alerts/acknowledge-bulk',
    ...protect(RBAC_MODULES.SYSTEM_ALERTS, UPDATE),
    validate({ body: AcknowledgeAlertsBody }),
    c.alerts.acknowledgeBulk
  );

  // Catálogo de acciones
  const catalog = () => protect(RBAC_MODULES.AUDIT_ACTION_CATALOG, READ);
  router.get('/audit/audit-action-catalog/categories', ...catalog(), c.catalog.categories);
  router.get('/audit/audit-action-catalog/risks', ...catalog(), c.catalog.risks);
  router.get('/audit/audit-action-catalog/modules', ...catalog(), c.catalog.modules);
  router.get('/audit/audit-action-catalog/actions', ...catalog(), validate({ query: AuditActionListQuery }), c.catalog.actions);

  // Bitácora de cambios
  router.get(
    '/audit/change-logs/users',
    ...protect(RBAC_MODULES.USER_CHANGES, READ),
    validate({ query: ChangeLogListQuery }),
    c.changeLogs.listUserChangeLogs
  );

  // Traza de sesiones (forense, solo lectura): mismo permiso que los logs
  router.get('/audit/sessions', ...protect(RBAC_MODULES.GLOBAL_LOGS, READ), validate({ query: SessionListQuery }), c.sessions.list);
  router.get(
    '/audit/sessions/:sessionId',
    ...protect(RBAC_MODULES.GLOBAL_LOGS, READ),
    validate({ params: SessionIdParams, query: SessionTimelineQuery }),
    c.sessions.timeline
  );
  router.get(
    '/audit/sessions/:sessionId/entities',
    ...protect(RBAC_MODULES.GLOBAL_LOGS, READ),
    validate({ params: SessionIdParams, query: SessionEntitiesQuery }),
    c.sessions.entities
  );

  // Traza de operaciones: mismo permiso que los logs
  router.get('/audit/operations', ...protect(RBAC_MODULES.GLOBAL_LOGS, READ), validate({ query: OperationListQuery }), c.operations.list);
  router.get(
    '/audit/operations/:operationId',
    ...protect(RBAC_MODULES.GLOBAL_LOGS, READ),
    validate({ params: OperationIdParams }),
    c.operations.timeline
  );

  return router;
}

/** Feed de actividad del PROPIO usuario (client-safe). Lectura: sin request lock. */
export function createAuditClientRouter(controller: UserActivityController, guards: RouteGuards): Router {
  const router = express.Router();
  router.get(
    '/audit/recent-activity',
    guards.requireRole(CLIENT_ACCESS_ROLES),
    RateLimitMiddleware.apiLimiter(),
    validate({ query: RecentActivityQuery }),
    controller.list
  );
  return router;
}
