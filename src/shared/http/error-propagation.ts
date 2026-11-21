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
//   - cualquier AppError: ya dice qué responder (un 400/404/409 de negocio, un 503 del circuito…).
//     Antes se usaba isOperationalError, que solo dejaba pasar los AppError graves (5xx): un 404 lanzado
//     adentro del try terminaba como 500.
//   - los errores temporales de la base (caída, conflicto de transacción): el middleware de errores los
//     responde 503 / 409 temporal. Envueltos en un 500, el cliente no reintentaría.
import AppError from './app-error.util';
import { isDatabaseUnavailable, isTransactionConflict } from '../database/database-errors';

function shouldPropagate(error: unknown): boolean {
  return error instanceof AppError || isDatabaseUnavailable(error) || isTransactionConflict(error);
}

export { shouldPropagate };
export default { shouldPropagate };
