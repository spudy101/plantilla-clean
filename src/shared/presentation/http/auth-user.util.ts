// `req.user` es opcional en el tipo de Express (solo existe después de AuthMiddleware). Los middlewares y
// controllers que corren DETRÁS de la autenticación lo usan con esta función: devuelve el usuario tipado
// o lanza 401 si la ruta quedó mal configurada (antes eso terminaba en un TypeError → 500).
import type { Request } from 'express';
import type { AuthenticatedUser } from '../types/express';
import AppError from './app-error.util';

function requireAuthUser(req: Request): AuthenticatedUser {
  if (!req.user) {
    throw AppError.unauthorized('Usuario no autenticado');
  }
  return req.user;
}

/**
 * Usuario autenticado que además tiene persona asociada (clientes y funcionarios la tienen siempre;
 * un token viejo sin el claim personId → 401 en vez de consultar con null).
 */
function requireAuthPerson(req: Request): AuthenticatedUser & { personId: string } {
  const user = requireAuthUser(req);
  if (!user.personId) {
    throw AppError.unauthorized('Sesión sin persona asociada');
  }
  return user as AuthenticatedUser & { personId: string };
}

export default { requireAuthUser, requireAuthPerson };
