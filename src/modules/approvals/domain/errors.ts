// Errores del dominio approvals. Los mensajes, códigos y detalles son los que respondía la plantilla en capas (el
// contrato de la API no cambia); la presentación decide el status HTTP por la familia del error.
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../../shared/domain/errors/domain-error';

export class UnknownDualApprovalOperationError extends InvalidInputError {
  constructor(operationKey: string) {
    super(`Operación de doble aprobación desconocida: ${operationKey}`, 'BAD_REQUEST', { code: 'UNKNOWN_DUAL_APPROVAL_OP' });
  }
}

/** Una sola solicitud pendiente por (operación, entidad). */
export class ApprovalAlreadyPendingError extends ConflictError {
  constructor(approvalRequestId: string) {
    super('Ya hay una solicitud de aprobación pendiente para esta operación sobre esta entidad', 'CONFLICT', {
      code: 'DUAL_APPROVAL_ALREADY_PENDING',
      approvalRequestId
    });
  }
}

export class ApprovalRequestNotFoundError extends NotFoundError {
  /** @param withCode false: la solicitud desapareció al cerrarla (se respondía sin el código del detalle). */
  constructor(withCode = true) {
    super('Solicitud de aprobación no encontrada', 'NOT_FOUND', withCode ? { code: 'APPROVAL_REQUEST_NOT_FOUND' } : null);
  }
}

export class ApprovalRequestNotPendingError extends ConflictError {
  constructor(status: string) {
    super(`La solicitud ya está en estado "${status}" y no puede re-resolverse`, 'CONFLICT', { code: 'APPROVAL_REQUEST_NOT_PENDING' });
  }
}

export class ApproverRoleNotAllowedError extends ForbiddenError {
  constructor() {
    super('Tu rol no está autorizado a resolver esta operación', 'FORBIDDEN', { code: 'DUAL_APPROVAL_ROLE_NOT_ALLOWED' });
  }
}

/** Segregación de funciones: quien origina la operación no la puede aprobar. */
export class ApproverIsMakerError extends ForbiddenError {
  constructor() {
    super('El segundo aprobador no puede ser el mismo que originó la operación (segregación de funciones)', 'FORBIDDEN', {
      code: 'DUAL_APPROVAL_SAME_AS_MAKER'
    });
  }
}

export class InvalidResolutionDecisionError extends InvalidInputError {
  constructor() {
    super('Decisión no reconocida', 'BAD_REQUEST', { code: 'INVALID_RESOLUTION_DECISION' });
  }
}

/** Ningún módulo registró la reanudación de la operación. */
export class NoApprovalHandlerError extends InvalidInputError {
  constructor(operationKey: string) {
    super(`No hay handler registrado para la operación "${operationKey}"`, 'BAD_REQUEST', { code: 'DUAL_APPROVAL_NO_HANDLER' });
  }
}
