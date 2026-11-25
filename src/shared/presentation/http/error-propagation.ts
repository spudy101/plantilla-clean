// ¿Un `catch` tiene que re-lanzar el error tal cual, o puede envolverlo en un 500 genérico?
//
// Patrón típico:
//   } catch (error) {
//     if (shouldPropagate(error)) throw error;           // ya tiene su respuesta
//     logger.error('…', { error });
//     throw AppError.internal('Error al crear el usuario');
//   }
//
// Se propagan:
//   - lo que ya dice qué responder: un AppError, un error del dominio o un error técnico de la aplicación (un
//     400/404/409 de negocio, un 503 de un proveedor…). Envuelto en un 500, un 404 lanzado adentro del try
//     terminaba como error interno.
//   - los errores temporales de la base (caída, conflicto de transacción): el middleware de errores los
//     responde 503 / 409 temporal. Envueltos en un 500, el cliente no reintentaría.
import AppError from './app-error.util';
import { isExpectedError } from '../../application/errors';
import { isDatabaseUnavailable, isTransactionConflict } from '../../infrastructure/database/database-errors';

function shouldPropagate(error: unknown): boolean {
  return error instanceof AppError || isExpectedError(error) || isDatabaseUnavailable(error) || isTransactionConflict(error);
}

export { shouldPropagate };
export default { shouldPropagate };
