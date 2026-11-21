// Adaptador: las guardas de ruta (shared/presentation/http/route-guards) con los middlewares de iam.
import iamModule from '../../modules/iam';
import type { RouteGuards } from '../../shared/presentation/http/route-guards';

export const routeGuardsAdapter: RouteGuards = {
  get authenticate() {
    return iamModule.AuthMiddleware.authenticate;
  },
  requirePermission: (moduleName, action) => iamModule.RbacMiddleware.requirePermission(moduleName, action)
};
