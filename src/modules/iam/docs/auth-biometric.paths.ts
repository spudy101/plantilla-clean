import commonResponses from '../../../config/swagger/responses/common.responses';
import { jsonBody, toOpenApi, toParameters } from '../../../shared/validation/openapi';
import {
  BiometricCredentialParams,
  BiometricLoginFinishBody,
  BiometricLoginStartBody,
  BiometricRegisterFinishBody
} from '../requests/iam.request';
import { BiometricCredentialSchema } from '../responses/auth-components.response';
import {
  BiometricCredentialListSchema,
  BiometricLoginStartSchema,
  BiometricRegisterFinishSchema,
  BiometricRegisterStartSchema
} from '../responses/auth-biometric.response';

/**
 * ============================================================
 * AUTH BIOMETRIC PATHS — CLIENT
 * ============================================================
 * Módulo: /client/api/v1/auth/biometric
 *
 * Flujo de registro (requiere dispositivo TRUSTED):
 *   POST /client/api/v1/auth/biometric/register/start   → genera challenge
 *   POST /client/api/v1/auth/biometric/register/finish  → registra credencial
 *
 * Flujo de login (público):
 *   POST /client/api/v1/auth/biometric/login/start      → genera challenge
 *   POST /client/api/v1/auth/biometric/login/finish     → autentica y devuelve tokens
 *
 * Gestión (requiere autenticación):
 *   GET    /client/api/v1/auth/biometric/credentials    → lista credenciales activas
 *   DELETE /client/api/v1/auth/biometric/:credentialId  → elimina credencial
 */

// ─── Schemas propios del módulo ───────────────────────────────

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  BiometricRegisterStartResponse: toOpenApi(BiometricRegisterStartSchema, 'output'),
  BiometricRegisterFinishRequest: toOpenApi(BiometricRegisterFinishBody),
  BiometricRegisterFinishResponse: toOpenApi(BiometricRegisterFinishSchema, 'output'),
  BiometricLoginStartRequest: toOpenApi(BiometricLoginStartBody),
  BiometricLoginStartResponse: toOpenApi(BiometricLoginStartSchema, 'output'),
  BiometricLoginFinishRequest: toOpenApi(BiometricLoginFinishBody),
  BiometricCredential: toOpenApi(BiometricCredentialSchema, 'output'),
  BiometricCredentialListResponse: toOpenApi(BiometricCredentialListSchema, 'output')
};

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  // ── POST /auth/biometric/register/start ─────────────────────
  '/client/api/v1/auth/biometric/register/start': {
    post: {
      tags: ['Auth - Biométrico'],
      summary: 'Iniciar registro de huella',
      description: `Genera un challenge para registrar una nueva credencial biométrica.

**Requisito:** el dispositivo debe tener estado \`trusted\`. No es posible registrar una huella desde un dispositivo pendiente de aprobación.

**Flujo completo:**
1. \`POST /auth/biometric/register/start\` → recibe \`challenge\` + \`deviceId\`
2. El dispositivo firma el challenge con su llave privada ES256 y genera un par de llaves
3. \`POST /auth/biometric/register/finish\` → envía \`credentialId\`, \`publicKey\`, \`challenge\`, \`signature\``,
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/BiometricRegisterStartResponse' },
          'Challenge de registro generado.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.Conflict,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /auth/biometric/register/finish ────────────────────
  '/client/api/v1/auth/biometric/register/finish': {
    post: {
      tags: ['Auth - Biométrico'],
      summary: 'Completar registro de huella',
      description: `Recibe la llave pública y la firma del challenge para registrar la credencial biométrica.

**Algoritmo soportado:** ES256 (ECDSA con P-256 y SHA-256).

La firma puede venir en formato DER o en formato raw (r||s, 64 bytes) — el servidor detecta automáticamente.`,
      requestBody: jsonBody('BiometricRegisterFinishRequest'),
      responses: {
        201: commonResponses.created(
          { $ref: '#/components/schemas/BiometricRegisterFinishResponse' },
          'Huella registrada exitosamente.'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.Conflict,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /auth/biometric/login/start ────────────────────────
  '/client/api/v1/auth/biometric/login/start': {
    post: {
      tags: ['Auth - Biométrico'],
      summary: 'Iniciar login biométrico',
      description: `Genera un challenge de autenticación a partir del \`nationalId\` del usuario.

**Endpoint público** — no requiere token.

El challenge expira en **5 minutos**. Si el usuario no completa el login en ese tiempo, debe iniciar el flujo nuevamente.`,
      security: [],
      requestBody: jsonBody('BiometricLoginStartRequest'),
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/BiometricLoginStartResponse' },
          'Challenge de autenticación generado.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /auth/biometric/login/finish ───────────────────────
  '/client/api/v1/auth/biometric/login/finish': {
    post: {
      tags: ['Auth - Biométrico'],
      summary: 'Completar login biométrico',
      description: `Verifica la firma del dispositivo y autentica al usuario. La huella actúa como **segundo factor** — bypasea el MFA (segundo factor propio).

**Endpoint público** — no requiere token.

**Validaciones de seguridad:**
- El challenge debe ser válido, no expirado y no utilizado previamente.
- El \`signCount\` debe ser mayor al almacenado (protección anti-replay).
- La firma ES256 debe ser válida con la llave pública registrada.
- El dispositivo asociado a la credencial debe seguir siendo \`trusted\`.

La respuesta incluye \`hmacSecret\` que el dispositivo debe guardar en el **keychain** para firmar requests posteriores.`,
      security: [],
      requestBody: jsonBody('BiometricLoginFinishRequest'),
      responses: {
        200: commonResponses.ok(
          {
            oneOf: [{ $ref: '#/components/schemas/LoginResponse' }, { $ref: '#/components/schemas/PolicyUpdateRequiredResponse' }]
          },
          'Autenticación biométrica exitosa, o política desactualizada.'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── GET /auth/biometric/credentials ─────────────────────────
  '/client/api/v1/auth/biometric/credentials': {
    get: {
      tags: ['Auth - Biométrico'],
      summary: 'Listar credenciales biométricas',
      description:
        'Retorna todas las credenciales biométricas activas del usuario autenticado, ordenadas por fecha de creación descendente.',
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/BiometricCredentialListResponse' },
          'Credenciales biométricas obtenidas.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── DELETE /auth/biometric/:credentialId ─────────────────────
  '/client/api/v1/auth/biometric/{credentialId}': {
    delete: {
      tags: ['Auth - Biométrico'],
      summary: 'Eliminar credencial biométrica',
      description: `Desactiva (soft delete) una credencial biométrica del usuario.

Tras eliminarla, el dispositivo asociado ya no podrá hacer login biométrico hasta registrar una nueva huella.`,
      parameters: toParameters(BiometricCredentialParams, 'path'),
      responses: {
        ...commonResponses.noContent,
        ...commonResponses.Unauthorized,
        ...commonResponses.NotFound,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
