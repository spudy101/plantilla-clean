// config/swagger/modules/shared-endpoints/core/promotional-banner.paths.ts

import commonResponses from '../../../shared/presentation/openapi/common.responses';
import { toOpenApi } from '../../../shared/presentation/validation/openapi';
import { PublicBanner, PublicBannerList } from '../responses/promotional-banner.response';

/**
 * ============================================================
 * PROMOTIONAL BANNER PATHS — CLIENT (PÚBLICO)
 * ============================================================
 * Módulo: /client/api/v1/core/promotional-banners (core, sin subdominio)
 * Banners promocionales de la landing pública y la app cliente.
 *
 * Endpoint público (sin autenticación, rate limit público estricto, patrón del
 * formulario de contacto). El mantenedor vive en el panel admin
 * (`/admin/api/v1/core/promotional-banners`).
 *
 * Rutas:
 *   GET /client/api/v1/core/promotional-banners
 */

// ─── Schemas ──────────────────────────────────────────────────

// Generados desde los esquemas Zod de responses/.
const schemas = {
  PublicPromotionalBannerItem: toOpenApi(PublicBanner, 'output'),
  PublicPromotionalBannerListResponse: toOpenApi(PublicBannerList, 'output')
};

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  '/client/api/v1/core/promotional-banners': {
    get: {
      tags: ['Banners Promocionales (Público)'],
      summary: 'Listar banners promocionales publicados',
      operationId: 'publicListPromotionalBanners',
      description:
        'Banners promocionales para la landing pública y la app cliente. **Público, sin autenticación** ' +
        '(rate limit público estricto anti-abuso). Devuelve solo los banners **activos**, ya ordenados por ' +
        '`sortOrder`; no expone `isActive` ni `sortOrder`. Sin banners publicados devuelve `banners: []`. ' +
        'Respuesta cacheada en el servidor (TTL 60 s): un cambio hecho por el admin se refleja a lo sumo un minuto después.',
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/PublicPromotionalBannerListResponse' },
          'Banners promocionales obtenidos exitosamente'
        ),
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
