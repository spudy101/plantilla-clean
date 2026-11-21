// shared/utils/route-param.util.ts
//
// Parámetro de ruta (/users/:userId) como string. Express lo garantiza cuando la ruta matchea, pero
// el tipo es `string | undefined` (índice de ParamsDictionary). Si falta, la ruta está mal
// declarada: 400 explícito en vez de seguir con undefined hasta la BD.
import type { Request } from 'express';
import AppError from './app-error.util';

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value === '') {
    throw AppError.badRequest(`Falta el parámetro de ruta "${name}"`);
  }
  return value;
}

export default { routeParam };
