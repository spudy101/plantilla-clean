import commonResponses from '../../../../../shared/presentation/openapi/common.responses';
import { jsonBody, toOpenApi } from '../../../../../shared/presentation/validation/openapi';
import {
  DeleteAccountBody,
  UpdateEmailBody,
  UpdateNamesBody,
  UpdatePasswordBody,
  UpdatePhoneBody,
  UpdateProfileBody
} from '../requests/person.request';
import { EmailUpdatedSchema, NamesUpdatedSchema, PhoneUpdatedSchema } from '../responses/profile.response';
import piiMaskingDocModule from '../../../../../shared/presentation/validation/pii-masking.doc';
const { MASKED_EMAIL_DESC } = piiMaskingDocModule;

/**
 * ============================================================
 * PROFILE PATHS
 * ============================================================
 * Módulo: /client/api/v1/kyc/person/profile
 * Todos los endpoints requieren autenticación (bearerAuth + idTokenAuth)
 *
 * Rutas:
 *   GET    /client/api/v1/kyc/person/profile
 *   GET    /client/api/v1/kyc/person/profile/extended
 *   GET    /client/api/v1/kyc/person/profile/location
 *   GET    /client/api/v1/kyc/person/profile/contact
 *   PUT    /client/api/v1/kyc/person/profile
 *   PUT    /client/api/v1/kyc/person/profile/email
 *   PUT    /client/api/v1/kyc/person/profile/phone
 *   PUT    /client/api/v1/kyc/person/profile/password
 *   PUT    /client/api/v1/kyc/person/profile/names
 *   DELETE /client/api/v1/kyc/person/profile/delete-account
 */

// ─── Schemas propios del módulo ───────────────────────────────

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  UpdateProfileRequest: toOpenApi(UpdateProfileBody),
  UpdateEmailRequest: toOpenApi(UpdateEmailBody),
  UpdateEmailResponse: toOpenApi(EmailUpdatedSchema, 'output'),
  UpdatePhoneRequest: toOpenApi(UpdatePhoneBody),
  UpdatePhoneResponse: toOpenApi(PhoneUpdatedSchema, 'output'),
  UpdatePasswordRequest: toOpenApi(UpdatePasswordBody),
  UpdateNamesRequest: toOpenApi(UpdateNamesBody),
  UpdateNamesResponse: toOpenApi(NamesUpdatedSchema, 'output'),
  DeleteAccountRequest: toOpenApi(DeleteAccountBody)
};

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  // ── GET /client/api/v1/kyc/person/profile ────────────────────
  '/client/api/v1/kyc/person/profile': {
    get: {
      tags: ['Profile'],
      summary: 'Obtener perfil básico',
      operationId: 'getProfile',
      description:
        'Devuelve los datos esenciales del usuario: info de usuario, persona, contacto, ubicación, cuenta ' +
        'y los consentimientos vigentes (aceptados) del usuario.\n\n' +
        '**Datos PII enmascarados (RF-USR-01 CA-6):** documento, correo y teléfonos salen enmascarados; el valor ' +
        'completo nunca sale por la API.',
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/BasicProfile' }, 'Perfil básico obtenido.'),
        ...commonResponses.NotFound,
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    },
    put: {
      tags: ['Profile'],
      summary: 'Actualizar perfil',
      operationId: 'updateProfile',
      description:
        'Actualiza uno o más campos del perfil: username, avatar, género, ubicación y/o fecha de nacimiento. ' +
        'Debe enviarse al menos un campo. `birthDate` es editable normalmente.',
      requestBody: jsonBody('UpdateProfileRequest'),
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/ExtendedProfile' },
          'Perfil actualizado. Devuelve el perfil extendido actualizado.'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.ValidationError,
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── GET /client/api/v1/kyc/person/profile/extended ───────────
  '/client/api/v1/kyc/person/profile/extended': {
    get: {
      tags: ['Profile'],
      summary: 'Obtener perfil extendido',
      operationId: 'getExtendedProfile',
      description:
        'Devuelve el perfil completo del usuario junto con los consentimientos vigentes (aceptados).\n\n' +
        '**Datos PII enmascarados (RF-USR-01 CA-6):** documento, correo y teléfonos salen enmascarados.',
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/ExtendedProfile' }, 'Perfil extendido obtenido.'),
        ...commonResponses.NotFound,
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── GET /client/api/v1/kyc/person/profile/location ───────────
  '/client/api/v1/kyc/person/profile/location': {
    get: {
      tags: ['Profile'],
      summary: 'Obtener ubicación del usuario',
      operationId: 'getLocation',
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/PersonLocation' }, 'Ubicación obtenida.'),
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── GET /client/api/v1/kyc/person/profile/contact ────────────
  '/client/api/v1/kyc/person/profile/contact': {
    get: {
      tags: ['Profile'],
      summary: 'Obtener información de contacto',
      operationId: 'getContactInfo',
      description: `Devuelve email, teléfonos con prefijos y fecha de verificación del email. ${MASKED_EMAIL_DESC}`,
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/PersonContact' }, 'Información de contacto obtenida.'),
        ...commonResponses.NotFound,
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── PUT /client/api/v1/kyc/person/profile/email ──────────────
  '/client/api/v1/kyc/person/profile/email': {
    put: {
      tags: ['Profile'],
      summary: 'Actualizar email',
      operationId: 'updateEmail',
      description:
        '⚠️ El nuevo email debe estar verificado previamente con `/verification/send-verification`. Requiere contraseña actual como confirmación.',
      requestBody: jsonBody('UpdateEmailRequest'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/UpdateEmailResponse' }, 'Email actualizado exitosamente.'),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── PUT /client/api/v1/kyc/person/profile/phone ──────────────
  '/client/api/v1/kyc/person/profile/phone': {
    put: {
      tags: ['Profile'],
      summary: 'Actualizar teléfono',
      operationId: 'updatePhone',
      requestBody: jsonBody('UpdatePhoneRequest'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/UpdatePhoneResponse' }, 'Teléfono actualizado exitosamente.'),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── PUT /client/api/v1/kyc/person/profile/password ───────────
  '/client/api/v1/kyc/person/profile/password': {
    put: {
      tags: ['Profile'],
      summary: 'Cambiar contraseña',
      operationId: 'updatePassword',
      requestBody: jsonBody('UpdatePasswordRequest'),
      responses: {
        200: commonResponses.ok({ type: 'object', nullable: true }, 'Contraseña actualizada exitosamente.'),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── PUT /client/api/v1/kyc/person/profile/names ──────────────
  '/client/api/v1/kyc/person/profile/names': {
    put: {
      tags: ['Profile'],
      summary: 'Actualizar nombres',
      operationId: 'updateNames',
      description: 'Actualiza los nombres del cliente: primer nombre, segundo nombre, primer apellido y segundo apellido.',
      requestBody: jsonBody('UpdateNamesRequest'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/UpdateNamesResponse' }, 'Nombres actualizados exitosamente.'),
        ...commonResponses.BadRequest,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── DELETE /client/api/v1/kyc/person/profile/delete-account ──
  '/client/api/v1/kyc/person/profile/delete-account': {
    delete: {
      tags: ['Profile'],
      summary: 'Eliminar cuenta',
      operationId: 'deleteAccount',
      description:
        '⚠️ **Acción irreversible.** Anonimiza y desactiva la cuenta del usuario en BD (soft-delete); ' +
        'revoca los consentimientos vigentes. Se envía una notificación de confirmación al email registrado. ' +
        'Requiere contraseña actual.',
      requestBody: jsonBody('DeleteAccountRequest'),
      responses: {
        200: commonResponses.ok({ type: 'object', nullable: true }, 'Cuenta eliminada exitosamente.'),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Conflict,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
