import commonResponses from '../../../shared/presentation/openapi/common.responses';
import { jsonBody, toOpenApi, toParameters } from '../../../shared/presentation/validation/openapi';
import { ConfirmResetBody, RegisterBody, RegisterHeaders, RequestResetBody } from '../requests/iam.request';
import { RegisterSchema } from '../responses/auth-register.response';
import piiMaskingDocModule from '../../../shared/presentation/validation/pii-masking.doc';
const { UNMASKED_ROUTE_DESC } = piiMaskingDocModule;

/**
 * ============================================================
 * AUTH REGISTER PATHS
 * ============================================================
 * Módulo: /client/api/v1/auth
 * Endpoints públicos — sin bearerAuth
 *
 * Rutas:
 *   POST /client/api/v1/auth/register
 *   POST /client/api/v1/auth/reset-credentials/request
 *   POST /client/api/v1/auth/reset-credentials/confirm
 */

// ─── Schemas propios del módulo ───────────────────────────────

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  RegisterRequest: toOpenApi(RegisterBody),
  RegisterResponse: toOpenApi(RegisterSchema, 'output'),
  ResetCredentialsRequestBody: toOpenApi(RequestResetBody),
  ResetCredentialsConfirmBody: toOpenApi(ConfirmResetBody)
};

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  // ── POST /auth/register ──────────────────────────────────────
  '/client/api/v1/auth/register': {
    post: {
      tags: ['Auth - Register'],
      summary: 'Registrar nuevo usuario',
      description: `Crea un nuevo usuario en BD. Retorna tokens RS256 de sesión listos para usar.

**Prerequisitos:**
1. El email debe estar verificado previamente (ver \`/verification/send-verification\`).
2. El usuario debe aceptar la política de privacidad vigente (\`acceptedPrivacyPolicy: true\`). Este documento único cubre Política de Privacidad, Términos y Condiciones y Tratamiento de Datos.
3. _(Opcional)_ El usuario puede aceptar comunicaciones comerciales en el mismo paso (\`comunicacionesComerciales: true\`). Si no se envía, no se registra ningún consentimiento comercial y no se enviarán comunicaciones de marketing.

El usuario teclea sus propios datos (\`birthDate\` es un campo normal requerido).

${UNMASKED_ROUTE_DESC}
Por eso \`person\`, \`contact\` y demás datos personales de esta respuesta salen **completos**, aunque los schemas
compartidos (\`Person\`, \`PersonContact\`) documenten el valor enmascarado que sí aplica al resto de la API.`,
      security: [],
      parameters: toParameters(RegisterHeaders, 'header'),
      requestBody: jsonBody('RegisterRequest'),
      responses: {
        201: commonResponses.created({ $ref: '#/components/schemas/RegisterResponse' }, 'Usuario registrado exitosamente.'),
        ...commonResponses.BadRequest,
        ...commonResponses.Forbidden,
        ...commonResponses.Conflict,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /auth/reset-credentials/request ────────────────────
  '/client/api/v1/auth/reset-credentials/request': {
    post: {
      tags: ['Auth - Register'],
      summary: 'Solicitar reset de credenciales',
      description: `Envía email con link para resetear password o desactivar MFA. **Respuesta siempre exitosa** — no revela si el email existe.

**Rate limit:** máximo 3 solicitudes por hora por IP.`,
      security: [],
      requestBody: jsonBody('ResetCredentialsRequestBody'),
      responses: {
        200: commonResponses.ok(
          { type: 'object', nullable: true },
          'Solicitud procesada. Si el email existe, recibirás un correo.'
        ),
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /auth/reset-credentials/confirm ────────────────────
  '/client/api/v1/auth/reset-credentials/confirm': {
    post: {
      tags: ['Auth - Register'],
      summary: 'Confirmar reset de credenciales',
      description: `Aplica el reset usando el token recibido por email.

- \`type = password\`: actualiza la contraseña en BD. **Invalida automáticamente todas las sesiones activas** del usuario.
- \`type = mfa\`: desactiva el TOTP en BD.

El token tiene una validez de tiempo limitado y solo puede usarse una vez.`,
      security: [],
      requestBody: jsonBody('ResetCredentialsConfirmBody'),
      responses: {
        200: commonResponses.ok({ type: 'object', nullable: true }, 'Credenciales reseteadas exitosamente.'),
        ...commonResponses.BadRequest,
        ...commonResponses.NotFound,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
