// Adaptador: las guardas de ruta (shared/presentation/http/route-guards) con las guardas HTTP de iam.
//
// Los routers de los demás módulos se arman con estas guardas. Cada una busca la de iam al recibir el request
// (los módulos se crean en un orden y iam no tiene por qué estar primero).
import type { RequestHandler } from 'express';
import { markOperationSource } from '../../shared/infrastructure/observability/operation';
import type { RouteGuards } from '../../shared/presentation/http/route-guards';
import type { ModuleRegistry } from './module-registry';

export function routeGuardsAdapter(modules: ModuleRegistry): RouteGuards {
  return {
    authenticate: (req, res, next) => modules.iam.guards.authenticate(req, res, next),
    requirePermission(moduleName, action) {
      let guard: RequestHandler | null = null;
      return (req, res, next) => (guard ??= modules.iam.guards.requirePermission(moduleName, action))(req, res, next);
    },
    requireRole(roles) {
      let guard: RequestHandler | null = null;
      return (req, res, next) => (guard ??= modules.iam.guards.requireRole(roles))(req, res, next);
    }
  };
}

/** Las guardas de quien no es un usuario: otro sistema (X-API-Key) y un webhook (apikey en la query). */
export function externalGuardsAdapter(modules: ModuleRegistry): {
  authenticateExternalService: RequestHandler;
  authenticateWebhook: RequestHandler;
  markWebhookOperation: RequestHandler;
} {
  return {
    authenticateExternalService: (req, res, next) => modules.iam.guards.externalAuthenticate(req, res, next),
    authenticateWebhook: (req, res, next) => modules.iam.guards.externalWebhookAuthenticate(req, res, next),
    markWebhookOperation: markOperationSource('webhook')
  };
}
