// Errores del dominio de settings. La presentación decide su status HTTP (not_found → 404).
// El código es 'NOT_FOUND', el mismo que respondía la plantilla en capas: el contrato de la API no cambia.
import { NotFoundError } from '../../../shared/domain/errors/domain-error';

/** No hay ninguna configuración global activa. */
export class ActiveConfigNotFoundError extends NotFoundError {
  constructor() {
    super('No hay una configuración global activa. Contacta al equipo de infraestructura.', 'NOT_FOUND');
  }
}

/** La configuración que se estaba actualizando dejó de existir. */
export class ConfigNotFoundError extends NotFoundError {
  constructor() {
    super('Configuración global no encontrada', 'NOT_FOUND');
  }
}
