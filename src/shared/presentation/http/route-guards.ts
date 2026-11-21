// Lo que una ruta necesita para proteger un endpoint: saber quién llama y si tiene permiso.
//
// Los routers de los módulos en Clean Architecture reciben esto por parámetro (no importan el módulo iam):
// src/main/ lo arma una vez con los middlewares reales de iam y se lo pasa a cada módulo.
import type { RequestHandler } from 'express';

export interface RouteGuards {
  /** Exige un usuario autenticado (deja req.user). */
  authenticate: RequestHandler;
  /** Exige el permiso `action` sobre el módulo RBAC `moduleName`. */
  requirePermission(moduleName: string, action: string): RequestHandler;
}
