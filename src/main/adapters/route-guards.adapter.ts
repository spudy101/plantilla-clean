// Adaptador: las guardas de ruta (shared/presentation/http/route-guards) con los middlewares de iam.
import type { RequestHandler } from 'express';
import iamModule from '../../modules/iam';
import { markOperationSource } from '../../shared/infrastructure/observability/operation';
import type { RouteGuards } from '../../shared/presentation/http/route-guards';

export const routeGuardsAdapter: RouteGuards = {
  get authenticate() {
    return iamModule.AuthMiddleware.authenticate;
  },
  requirePermission: (moduleName, action) => iamModule.RbacMiddleware.requirePermission(moduleName, action),
  requireRole: roles => iamModule.AuthMiddleware.requireRole(roles)
};

/** Las guardas de quien no es un usuario: otro sistema (X-API-Key) y un webhook (apikey en la query). */
export const externalGuardsAdapter: {
  authenticateExternalService: RequestHandler;
  authenticateWebhook: RequestHandler;
  markWebhookOperation: RequestHandler;
} = {
  get authenticateExternalService() {
    return iamModule.AuthMiddleware.externalAuthenticate;
  },
  get authenticateWebhook() {
    return iamModule.AuthMiddleware.externalWebhookAuthenticate;
  },
  markWebhookOperation: markOperationSource('webhook')
};
