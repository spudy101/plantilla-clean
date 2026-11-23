// Errores del dominio audit. Los mensajes y códigos son los que respondía la plantilla en capas (el contrato
// de la API no cambia); la presentación decide el status HTTP por la familia del error.
import { NotFoundError } from '../../../shared/domain/errors/domain-error';

export class AuditLogNotFoundError extends NotFoundError {
  constructor() {
    super('Log de auditoría no encontrado', 'NOT_FOUND');
  }
}

export class PendingAlertNotFoundError extends NotFoundError {
  constructor() {
    super('Alerta no encontrada o ya estaba reconocida', 'NOT_FOUND');
  }
}

export class OperationNotFoundError extends NotFoundError {
  constructor() {
    super('Operación no encontrada', 'NOT_FOUND');
  }
}

export class SessionNotFoundError extends NotFoundError {
  constructor() {
    super('Sesión no encontrada', 'NOT_FOUND');
  }
}
