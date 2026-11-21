// Errores del dominio de banners. Los códigos son los que respondía la plantilla en capas.
import { InvalidInputError, NotFoundError } from '../../../shared/domain/errors/domain-error';

/** Los banners viven en la configuración global activa: si no hay, no hay dónde leerlos ni guardarlos. */
export class BannerCatalogNotFoundError extends NotFoundError {
  constructor() {
    super('No hay una configuración global activa. Contacta al equipo de infraestructura.', 'NOT_FOUND');
  }
}

/** La configuración donde se iba a guardar el catálogo dejó de existir. */
export class BannerCatalogVanishedError extends NotFoundError {
  constructor() {
    super('Configuración global no encontrada', 'NOT_FOUND');
  }
}

export class BannerImageRequiredError extends InvalidInputError {
  constructor() {
    super('La imagen del banner es requerida (campo multipart "image")', 'BAD_REQUEST');
  }
}
