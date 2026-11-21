import commonResponses from '../../../../../shared/presentation/openapi/common.responses';
import { toOpenApi } from '../../../../../shared/presentation/validation/openapi';
import { ReplaceBannersBody } from '../requests/admin-promotional-banner.request';
import { AdminBanner, AdminBannerList, BannerImage } from '../responses/admin-promotional-banner.response';

/**
 * ============================================================
 * PROMOTIONAL BANNER PATHS — ADMIN
 * ============================================================
 * Módulo: /admin/api/v1/core/promotional-banners (core, sin subdominio)
 * Mantenedor de los banners promocionales de la landing pública + app cliente.
 * RBAC: módulo `promotionalContent` (READ el GET · UPDATE el PUT · CREATE la imagen).
 *
 * Rutas:
 *   GET  /admin/api/v1/core/promotional-banners        — catálogo completo (activos e inactivos)
 *   PUT  /admin/api/v1/core/promotional-banners        — reemplaza el catálogo completo
 *   POST /admin/api/v1/core/promotional-banners/image  — sube la imagen de un banner a S3
 */

const adminSecurity = [{ bearerAuth: [], idTokenAuth: [] }];
const TAG = 'Admin — Banners Promocionales';

// ─── Schemas ──────────────────────────────────────────────────

// Generados desde los esquemas Zod de requests/ y responses/: la documentación no puede desalinearse de
// lo que la API valida y devuelve.
const schemas = {
  PromotionalBannerAdminItem: toOpenApi(AdminBanner, 'output'),
  PromotionalBannerAdminListResponse: toOpenApi(AdminBannerList, 'output'),
  PromotionalBannerReplaceRequest: toOpenApi(ReplaceBannersBody),
  PromotionalBannerImageResponse: toOpenApi(BannerImage, 'output')
};

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  '/admin/api/v1/core/promotional-banners': {
    get: {
      tags: [TAG],
      summary: 'Listar banners promocionales (catálogo completo)',
      operationId: 'adminListPromotionalBanners',
      description:
        'Catálogo completo de banners (activos e inactivos), ordenado por `sortOrder`. ' +
        'Requiere permiso `promotionalContent:READ`. La vista pública (solo activos, sin isActive/sortOrder) ' +
        'es `GET /client/api/v1/core/promotional-banners`.',
      security: adminSecurity,
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/PromotionalBannerAdminListResponse' },
          'Banners promocionales obtenidos exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    },

    put: {
      tags: [TAG],
      summary: 'Reemplazar el catálogo de banners',
      operationId: 'adminReplacePromotionalBanners',
      description:
        'Reemplaza el catálogo COMPLETO de banners (máximo 20): lo que no venga en `banners` se elimina, ' +
        'lo que venga sin `id` se crea. Requiere permiso `promotionalContent:UPDATE`. ' +
        'Devuelve el catálogo resultante (misma respuesta del GET). ' +
        'Las imágenes que dejan de estar referenciadas y fueron subidas por `POST …/image` ' +
        '(prefijo `promotional/banners/`) se borran de S3 automáticamente; las URLs externas no se tocan.',
      security: adminSecurity,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/PromotionalBannerReplaceRequest' } }
        }
      },
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/PromotionalBannerAdminListResponse' },
          'Banners promocionales actualizados exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/core/promotional-banners/image': {
    post: {
      tags: [TAG],
      summary: 'Subir imagen de banner',
      operationId: 'adminUploadPromotionalBannerImage',
      description:
        'Sube la imagen de un banner a S3 y devuelve su URL para usarla como `imageUrl` en el PUT del catálogo. ' +
        'Multipart, campo `image`, formatos PNG/JPEG/WebP, tamaño máximo 10 MB. ' +
        'Requiere permiso `promotionalContent:CREATE`.',
      security: adminSecurity,
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['image'],
              properties: {
                image: { type: 'string', format: 'binary', description: 'Imagen PNG, JPEG o WebP (≤ 10 MB).' }
              }
            }
          }
        }
      },
      responses: {
        201: commonResponses.created(
          { $ref: '#/components/schemas/PromotionalBannerImageResponse' },
          'Imagen del banner subida exitosamente'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
