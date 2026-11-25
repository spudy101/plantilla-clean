import commonResponses from '../../../../../shared/presentation/openapi/common.responses';
import { jsonBody, toOpenApi } from '../../../../../shared/presentation/validation/openapi';
import { PasswordBody, PreferredMethodBody, SmsActivationCodeBody, TotpCodeBody } from '../requests/iam.request';
import {
  MfaStatusSchema,
  PreferredMethodSchema,
  SmsActivationRequestSchema,
  SmsMfaActivationSchema,
  TotpActivationSchema,
  TotpSetupSchema,
  ValidationResultSchema
} from '../responses/mfa.response';

/**
 * ============================================================
 * MFA PATHS
 * ============================================================
 * Módulo: /client/api/v1/kyc/iam/mfa
 * Todos los endpoints requieren autenticación (bearerAuth + idTokenAuth)
 *
 * Rutas:
 *   POST /client/api/v1/kyc/iam/mfa/setup-totp
 *   POST /client/api/v1/kyc/iam/mfa/activate-totp
 *   POST /client/api/v1/kyc/iam/mfa/verify-totp
 *   POST /client/api/v1/kyc/iam/mfa/validate-password
 *   POST /client/api/v1/kyc/iam/mfa/deactivate-totp
 */

// ─── Schemas propios del módulo ───────────────────────────────

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  TOTPSetupResponse: toOpenApi(TotpSetupSchema, 'output'),
  TOTPCodeRequest: toOpenApi(TotpCodeBody),
  TOTPActivationResponse: toOpenApi(TotpActivationSchema, 'output'),
  TOTPVerificationResponse: toOpenApi(ValidationResultSchema, 'output'),
  PasswordRequest: toOpenApi(PasswordBody),
  PasswordValidationResponse: toOpenApi(ValidationResultSchema, 'output'),
  MFAStatusResponse: toOpenApi(MfaStatusSchema, 'output'),
  SMSActivationRequestResponse: toOpenApi(SmsActivationRequestSchema, 'output'),
  SMSConfirmRequest: toOpenApi(SmsActivationCodeBody),
  SMSMFAActivationResponse: toOpenApi(SmsMfaActivationSchema, 'output'),
  PreferredMethodRequest: toOpenApi(PreferredMethodBody),
  PreferredMethodResponse: toOpenApi(PreferredMethodSchema, 'output')
};

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  // ── POST /client/api/v1/kyc/iam/mfa/setup-totp ───────────────
  '/client/api/v1/kyc/iam/mfa/setup-totp': {
    post: {
      tags: ['MFA'],
      summary: 'Iniciar configuración TOTP',
      operationId: 'setupTOTP',
      description: `Genera el secret TOTP y devuelve la URI \`otpauth://\` para crear el QR.

**Flujo completo de activación:**
1. \`POST /mfa/setup-totp\` → recibe \`otpauthUrl\` y \`secretCode\`
2. El usuario escanea el QR con Google Authenticator, Authy, etc.
3. \`POST /mfa/activate-totp\` → envía el código generado para confirmar.`,
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/TOTPSetupResponse' },
          'Configuración TOTP iniciada. Escanea el QR para continuar.'
        ),
        ...commonResponses.Conflict,
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/kyc/iam/mfa/activate-totp ────────────
  '/client/api/v1/kyc/iam/mfa/activate-totp': {
    post: {
      tags: ['MFA'],
      summary: 'Activar TOTP',
      operationId: 'activateTOTP',
      description:
        'Verifica el código TOTP generado por la app y activa MFA en la cuenta. Debe llamarse inmediatamente después de `setup-totp`.',
      requestBody: jsonBody('TOTPCodeRequest'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/TOTPActivationResponse' }, 'TOTP activado exitosamente.'),
        ...commonResponses.BadRequest,
        ...commonResponses.Conflict,
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/kyc/iam/mfa/verify-totp ──────────────
  '/client/api/v1/kyc/iam/mfa/verify-totp': {
    post: {
      tags: ['MFA'],
      summary: 'Verificar código TOTP (sesión activa)',
      operationId: 'verifyTOTP',
      description:
        'Valida un código TOTP para el usuario autenticado. Útil para confirmar acciones sensibles dentro de la app (distinto del `/auth/verify-mfa` que completa el login).',
      requestBody: jsonBody('TOTPCodeRequest'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/TOTPVerificationResponse' }, 'Resultado de la verificación TOTP.'),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/kyc/iam/mfa/validate-password ────────
  '/client/api/v1/kyc/iam/mfa/validate-password': {
    post: {
      tags: ['MFA'],
      summary: 'Validar contraseña actual',
      operationId: 'validatePassword',
      description:
        'Verifica que la contraseña ingresada es correcta. Útil como paso previo a acciones críticas que no requieren TOTP completo.',
      requestBody: jsonBody('PasswordRequest'),
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/PasswordValidationResponse' },
          'Resultado de la validación de contraseña.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/kyc/iam/mfa/deactivate-totp ──────────
  '/client/api/v1/kyc/iam/mfa/deactivate-totp': {
    post: {
      tags: ['MFA'],
      summary: 'Desactivar TOTP',
      operationId: 'deactivateTOTP',
      description:
        '⚠️ Desactiva MFA en la cuenta. Requiere contraseña actual como confirmación. Acción de alto riesgo — reduce la seguridad de la cuenta.',
      requestBody: jsonBody('PasswordRequest'),
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/TOTPActivationResponse' },
          'TOTP desactivado. `totpEnabled` será `false`.'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── GET /client/api/v1/kyc/iam/mfa/status ────────────────────
  '/client/api/v1/kyc/iam/mfa/status': {
    get: {
      tags: ['MFA'],
      summary: 'Estado actual del MFA',
      operationId: 'getMFAStatus',
      description: 'Devuelve el estado de todos los métodos MFA del usuario: TOTP activo, SMS activo y método preferido.',
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/MFAStatusResponse' }, 'Estado MFA obtenido.'),
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/kyc/iam/mfa/sms/request ──────────────
  '/client/api/v1/kyc/iam/mfa/sms/request': {
    post: {
      tags: ['MFA'],
      summary: 'Solicitar activación SMS MFA',
      operationId: 'requestSMSActivation',
      description: `Inicia el flujo de activación de SMS MFA. Genera un código OTP de 6 dígitos y lo envía al teléfono primario registrado en el perfil.

**Flujo completo:**
1. \`POST /mfa/sms/request\` → envía OTP al teléfono registrado
2. \`POST /mfa/sms/confirm\` → confirma con el código recibido

> ⚠️ El usuario debe tener un teléfono primario registrado. Si SMS MFA ya está activo, devuelve 409.
> ⚠️ Se permite 1 solicitud por minuto (rate limit de 60s por número de teléfono).`,
      requestBody: jsonBody('PasswordRequest'),
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/SMSActivationRequestResponse' },
          'Código OTP enviado. Confirma con `POST /mfa/sms/confirm`.'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Conflict,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/kyc/iam/mfa/sms/confirm ──────────────
  '/client/api/v1/kyc/iam/mfa/sms/confirm': {
    post: {
      tags: ['MFA'],
      summary: 'Confirmar activación SMS MFA',
      operationId: 'confirmSMSActivation',
      description: `Verifica el código OTP recibido por SMS y activa SMS MFA en la cuenta.

- Máximo **5 intentos** antes de invalidar el código.
- El código expira a los **15 minutos** de ser generado.
- Llama a \`POST /mfa/sms/request\` para obtener un nuevo código si se agotaron los intentos.`,
      requestBody: jsonBody('SMSConfirmRequest'),
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/SMSMFAActivationResponse' },
          'SMS MFA activado. `smsMfaEnabled` será `true`.'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Conflict,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/kyc/iam/mfa/deactivate-sms ───────────
  '/client/api/v1/kyc/iam/mfa/deactivate-sms': {
    post: {
      tags: ['MFA'],
      summary: 'Desactivar SMS MFA',
      operationId: 'deactivateSMS',
      description:
        '⚠️ Desactiva SMS MFA. Si el método preferido era `sms`, cambia automáticamente a `totp` (si está activo) o a `none`. Requiere contraseña actual como confirmación.',
      requestBody: jsonBody('PasswordRequest'),
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/SMSMFAActivationResponse' },
          'SMS MFA desactivado. `smsMfaEnabled` será `false`.'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── PUT /client/api/v1/kyc/iam/mfa/preferred-method ──────────
  '/client/api/v1/kyc/iam/mfa/preferred-method': {
    put: {
      tags: ['MFA'],
      summary: 'Cambiar método MFA preferido',
      operationId: 'updatePreferredMethod',
      description: `Establece el método MFA que se usará por defecto en el login.

- Para seleccionar \`totp\`: TOTP debe estar activo (\`totpEnabled: true\`).
- Para seleccionar \`sms\`: SMS MFA debe estar activo (\`smsMfaEnabled: true\`).
- Ambos métodos pueden estar activos simultáneamente; este endpoint define cuál se usa en el login.`,
      requestBody: jsonBody('PreferredMethodRequest'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/PreferredMethodResponse' }, 'Método preferido actualizado.'),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
