import commonResponses from '../../../shared/presentation/openapi/common.responses';
import { toOpenApi, toParameters } from '../../../shared/presentation/validation/openapi';
import * as requests from '../requests/maintainers.request';
import { ActivePrivacyPolicySchema, DocumentTypeSchema } from '../responses/maintainers.response';

// ─── Schemas y parámetros: generados desde los esquemas Zod ──
// (País, ciudad, género, avatar… son globales: src/config/swagger/schemas/kyc.schema.ts)

const schemas = {
  DocumentType: toOpenApi(DocumentTypeSchema, 'output'),
  ActivePrivacyPolicy: toOpenApi(ActivePrivacyPolicySchema, 'output')
};

const query = (schema: Parameters<typeof toParameters>[0]) => toParameters(schema, 'query');

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  // GET /client/api/v1/kyc/maintainers/document-types
  '/client/api/v1/kyc/maintainers/document-types': {
    get: {
      tags: ['Maintainers'],
      summary: 'Listar tipos de documento',
      operationId: 'listDocumentTypes',
      security: [],
      description:
        'Retorna todos los tipos de documento de identidad disponibles en el sistema (ej: Cédula de Ciudadanía, Pasaporte, NIT). No soporta paginación ni filtros.',
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/DocumentType' }),
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // GET /client/api/v1/kyc/maintainers/genders
  '/client/api/v1/kyc/maintainers/genders': {
    get: {
      tags: ['Maintainers'],
      summary: 'Listar géneros',
      operationId: 'listGenders',
      security: [],
      parameters: query(requests.GenderListQuery),
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/Gender' }),
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // GET /client/api/v1/kyc/maintainers/phone-prefixes
  '/client/api/v1/kyc/maintainers/phone-prefixes': {
    get: {
      tags: ['Maintainers'],
      summary: 'Listar prefijos telefónicos',
      operationId: 'listPhonePrefixes',
      security: [],
      parameters: query(requests.PhonePrefixListQuery),
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/PhonePrefix' }),
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // GET /client/api/v1/kyc/maintainers/countries
  '/client/api/v1/kyc/maintainers/countries': {
    get: {
      tags: ['Maintainers'],
      summary: 'Listar países',
      operationId: 'listCountries',
      security: [],
      parameters: query(requests.CountryListQuery),
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/Country' }),
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // GET /client/api/v1/kyc/maintainers/departments
  '/client/api/v1/kyc/maintainers/departments': {
    get: {
      tags: ['Maintainers'],
      summary: 'Listar departamentos / regiones',
      operationId: 'listDepartments',
      security: [],
      parameters: query(requests.DepartmentListQuery),
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/Department' }),
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // GET /client/api/v1/kyc/maintainers/cities
  '/client/api/v1/kyc/maintainers/cities': {
    get: {
      tags: ['Maintainers'],
      summary: 'Listar ciudades',
      operationId: 'listCities',
      security: [],
      parameters: query(requests.CityListQuery),
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/City' }),
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // GET /client/api/v1/kyc/maintainers/avatars
  '/client/api/v1/kyc/maintainers/avatars': {
    get: {
      tags: ['Maintainers'],
      summary: 'Listar avatares',
      operationId: 'listAvatars',
      security: [],
      parameters: query(requests.AvatarListQuery),
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/Avatar' }),
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // GET /client/api/v1/kyc/maintainers/avatar-themes
  '/client/api/v1/kyc/maintainers/avatar-themes': {
    get: {
      tags: ['Maintainers'],
      summary: 'Listar temas de avatares',
      operationId: 'listAvatarThemes',
      security: [],
      parameters: query(requests.AvatarThemeListQuery),
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/AvatarTheme' }),
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // GET /client/api/v1/kyc/maintainers/notification-types
  '/client/api/v1/kyc/maintainers/notification-types': {
    get: {
      tags: ['Maintainers'],
      summary: 'Listar tipos de notificación',
      operationId: 'listNotificationTypes',
      security: [],
      parameters: query(requests.NotificationTypeCatalogListQuery),
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/NotificationType' }),
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // GET /client/api/v1/kyc/maintainers/roles
  '/client/api/v1/kyc/maintainers/roles': {
    get: {
      tags: ['Maintainers'],
      summary: 'Listar roles del sistema',
      operationId: 'listRoles',
      security: [],
      parameters: query(requests.RoleListQuery),
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/Role' }),
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // GET /client/api/v1/kyc/maintainers/privacy-policy/active
  '/client/api/v1/kyc/maintainers/privacy-policy/active': {
    get: {
      tags: ['Maintainers'],
      summary: 'Obtener política de privacidad activa',
      operationId: 'getActivePrivacyPolicy',
      security: [],
      description:
        'Retorna la versión de la política de privacidad actualmente vigente. Útil para mostrar al usuario el documento antes de registrarse.',
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/ActivePrivacyPolicy' },
          'Política de privacidad activa obtenida exitosamente'
        ),
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
