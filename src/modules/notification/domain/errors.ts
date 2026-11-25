// Errores del dominio notification. Los mensajes y códigos son los que respondía la plantilla en capas (el
// contrato de la API no cambia); la presentación decide el status HTTP por la familia del error.
import {
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError
} from '../../../shared/domain/errors/domain-error';

// ── Tipos y categorías ────────────────────────────────────────
export class NotificationTypeRequiredError extends InvalidInputError {
  constructor() {
    super('tipoNotificacion es requerido', 'BAD_REQUEST');
  }
}

export class RecipientEmailRequiredError extends InvalidInputError {
  constructor() {
    super('email es requerido', 'BAD_REQUEST');
  }
}

/** El tipo que pide quien notifica no existe (o no está activo). */
export class NotificationTypeCodeNotFoundError extends NotFoundError {
  constructor(code: string) {
    super(`Tipo de notificación no encontrado: ${code}`, 'NOT_FOUND');
  }
}

export class NotificationTypeNotFoundError extends NotFoundError {
  constructor() {
    super('Tipo de notificación no encontrado', 'NOT_FOUND');
  }
}

export class NotificationCategoryNotFoundError extends NotFoundError {
  constructor() {
    super('Categoría de notificación no encontrada', 'NOT_FOUND');
  }
}

/** Al reasignar la categoría de un tipo, la indicada no existe. */
export class UnknownCategoryError extends InvalidInputError {
  constructor() {
    super('La categoría indicada no existe', 'BAD_REQUEST');
  }
}

export class CategoryCodeTakenError extends InvalidInputError {
  constructor(code: string) {
    super(`Ya existe una categoría con el código ${code}`, 'BAD_REQUEST');
  }
}

/** Una categoría con tipos asignados no se borra: primero hay que reasignarlos. */
export class CategoryInUseError extends InvalidInputError {
  constructor(assignedTypes: number) {
    super(`No se puede eliminar: la categoría tiene ${assignedTypes} tipo(s) asignado(s). Reasignalos primero.`, 'BAD_REQUEST');
  }
}

// ── Destinatarios y entregas ──────────────────────────────────
export class RecipientNotFoundError extends NotFoundError {
  constructor() {
    super('Usuario no encontrado', 'NOT_FOUND');
  }
}

export class InactiveRecipientError extends InvalidInputError {
  constructor() {
    super('No se puede notificar a un usuario inactivo', 'BAD_REQUEST');
  }
}

export class DeliveryNotFoundError extends NotFoundError {
  constructor() {
    super('Entrega de notificación no encontrada', 'NOT_FOUND');
  }
}

// ── Códigos de verificación ───────────────────────────────────
export class CodeRequestTooSoonError extends TooManyRequestsError {
  constructor(waitSeconds: number) {
    super(`Debes esperar ${waitSeconds} segundos antes de solicitar un nuevo código`, 'RATE_LIMIT', waitSeconds);
  }
}

export class VerificationCodeNotFoundError extends NotFoundError {
  constructor() {
    super('Código de verificación no encontrado o expirado', 'NOT_FOUND');
  }
}

export class CodeAlreadyUsedError extends InvalidInputError {
  constructor() {
    super('Este código ya fue utilizado', 'BAD_REQUEST');
  }
}

export class TooManyCodeAttemptsError extends ForbiddenError {
  constructor() {
    super('Excediste el número máximo de intentos. Solicita un nuevo código', 'FORBIDDEN');
  }
}

export class InvalidCodeError extends InvalidInputError {
  constructor(remaining: number) {
    super(`Código inválido. Te quedan ${remaining} intento${remaining !== 1 ? 's' : ''}`, 'BAD_REQUEST');
  }
}

// ── Feed de rebotes (webhook de SES vía SNS) ──────────────────
export class InvalidFeedSignatureError extends UnauthorizedError {
  constructor() {
    super('Firma SNS inválida', 'UNAUTHORIZED');
  }
}

export class UnauthorizedTopicError extends UnauthorizedError {
  constructor() {
    super('TopicArn no autorizado', 'UNAUTHORIZED');
  }
}

export class MalformedFeedError extends InvalidInputError {
  constructor(message: 'Cuerpo del webhook no es JSON válido' | 'El campo Message de SNS no es JSON válido') {
    super(message, 'BAD_REQUEST');
  }
}

/** Registrar un dispositivo para push en una plataforma que no está configurada. */
export class UnsupportedPushPlatformError extends InvalidInputError {
  constructor(platform: string) {
    super(`Plataforma no soportada: ${platform}`, 'BAD_REQUEST');
  }
}
