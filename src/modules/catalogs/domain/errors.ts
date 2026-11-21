// Errores del dominio de catálogos. Código 'NOT_FOUND': el mismo que respondía la plantilla en capas.
import { NotFoundError } from '../../../shared/domain/errors/domain-error';

export class ActivePrivacyPolicyNotFoundError extends NotFoundError {
  constructor() {
    super('No hay una política de privacidad activa configurada', 'NOT_FOUND');
  }
}
