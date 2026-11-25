import commonResponses from '../../../../../shared/presentation/openapi/common.responses';
import { jsonBody, toOpenApi } from '../../../../../shared/presentation/validation/openapi';
import { SendVerificationBody, VerifyCodeBody } from '../requests/notification.request';
import { SendVerificationSchema, VerifyCodeSchema } from '../responses/send-verification.response';

/**
 * ============================================================
 * SEND VERIFICATION PATHS — SHARED ENDPOINTS
 * ============================================================
 * Disponible en: servidor client y servidor admin
 * Endpoints públicos — sin bearerAuth
 *
 * Rutas:
 *   POST /client/api/v1/notification/send-verification
 *   POST /client/api/v1/notification/verify-code
 */

// ─── Schemas propios del módulo ───────────────────────────────

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  SendVerificationRequest: toOpenApi(SendVerificationBody),
  SendVerificationResponse: toOpenApi(SendVerificationSchema, 'output'),
  VerifyCodeRequest: toOpenApi(VerifyCodeBody),
  VerifyCodeResponse: toOpenApi(VerifyCodeSchema, 'output')
};

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  // ── POST /client/api/v1/notification/send-verification ──────
  '/client/api/v1/notification/send-verification': {
    post: {
      tags: ['Verification'],
      summary: 'Enviar código OTP',
      description: `Genera y envía un código OTP de 6 dígitos al email o teléfono indicado.

**Reglas importantes:**
- Debes esperar **60 segundos** entre solicitudes para el mismo contacto.
- El código expira a los **15 minutos**.
- Máximo **5 intentos** de verificación antes de que el código se invalide.`,
      security: [],
      requestBody: jsonBody('SendVerificationRequest'),
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/SendVerificationResponse' },
          'Código de verificación enviado exitosamente.'
        ),
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded, // antes TooManyRequests (no existe → el 429 no se documentaba)
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/notification/verify-code ────────────
  '/client/api/v1/notification/verify-code': {
    post: {
      tags: ['Verification'],
      summary: 'Verificar código OTP',
      description: `Valida el código OTP ingresado por el usuario.

**Flujo esperado:**
1. Llama a \`/send-verification\` para generar y enviar el código.
2. El usuario ingresa el código recibido.
3. Llama a este endpoint para verificarlo.
4. Si es correcto, el código queda marcado como **verificado** y no puede reutilizarse.

**Errores posibles:**
- \`400\` — Código inválido (devuelve los intentos restantes).
- \`403\` — Se agotaron los 5 intentos. Debes solicitar un nuevo código.
- \`404\` — Código no encontrado, ya usado, o expirado.`,
      security: [],
      requestBody: jsonBody('VerifyCodeRequest'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/VerifyCodeResponse' }, 'Código verificado exitosamente.'),
        ...commonResponses.BadRequest,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded, // antes TooManyRequests (no existe → el 429 no se documentaba)
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
