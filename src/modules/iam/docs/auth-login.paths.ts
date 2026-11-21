import commonResponses from '../../../config/swagger/responses/common.responses';
import { OtherSessionsClosedSchema, SessionClosedSchema } from '../responses/auth-login.response';
import { jsonBody, toOpenApi, toParameters } from '../../../shared/validation/openapi';
import {
  ClientTypeHeaders,
  DeviceIdParams,
  LoginBody,
  RefreshTokenHeaders,
  RenameDeviceBody,
  SessionIdParams,
  VerifyMfaBody
} from '../requests/iam.request';
import {
  AuthTokensSchema,
  DeviceApprovalRequiredSchema,
  LoginSchema,
  MfaRequiredSchema,
  PolicyUpdateRequiredSchema,
  TrustedDeviceListSchema,
  TrustedDeviceUpdateSchema
} from '../responses/auth-login.response';

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  AuthTokens: toOpenApi(AuthTokensSchema, 'output'),
  LoginResponse: toOpenApi(LoginSchema, 'output'),
  PolicyUpdateRequiredResponse: toOpenApi(PolicyUpdateRequiredSchema, 'output'),
  DeviceApprovalRequiredResponse: toOpenApi(DeviceApprovalRequiredSchema, 'output'),
  MFARequiredResponse: toOpenApi(MfaRequiredSchema, 'output'),
  TrustedDeviceList: toOpenApi(TrustedDeviceListSchema, 'output'),
  TrustedDeviceUpdate: toOpenApi(TrustedDeviceUpdateSchema, 'output'),
  LoginRequest: toOpenApi(LoginBody),
  VerifyMfaRequest: toOpenApi(VerifyMfaBody),
  RenameDeviceRequest: toOpenApi(RenameDeviceBody),
  SessionClosed: toOpenApi(SessionClosedSchema, 'output'),
  OtherSessionsClosed: toOpenApi(OtherSessionsClosedSchema, 'output')
};

// ─── Parámetros reutilizables ─────────────────────────────────

const paths = {
  // ── POST /client/api/v1/auth/login ───────────────────────────
  '/client/api/v1/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Iniciar sesión',
      operationId: 'login',
      security: [],
      parameters: toParameters(ClientTypeHeaders, 'header'),
      requestBody: jsonBody('LoginRequest'),
      responses: {
        200: commonResponses.ok(
          {
            oneOf: [
              { $ref: '#/components/schemas/LoginResponse' },
              { $ref: '#/components/schemas/MFARequiredResponse' },
              { $ref: '#/components/schemas/DeviceApprovalRequiredResponse' },
              { $ref: '#/components/schemas/PolicyUpdateRequiredResponse' }
            ]
          },
          'Login exitoso, MFA requerido, dispositivo pendiente, o política desactualizada.'
        ),
        ...commonResponses.Forbidden,
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/auth/verify-mfa ──────────────────────
  '/client/api/v1/auth/verify-mfa': {
    post: {
      tags: ['Auth'],
      summary: 'Verificar código MFA para completar el login',
      operationId: 'verifyMFA',
      security: [],
      parameters: toParameters(ClientTypeHeaders, 'header'),
      description: `Verifica el código MFA del challenge iniciado en \`/auth/login\` y completa la sesión.

**Según el \`challengeType\` recibido en el login:**
| \`challengeType\`       | Campo a enviar | Instrucción para el usuario                        |
|------------------------|----------------|----------------------------------------------------|
| \`SOFTWARE_TOKEN_MFA\` | \`totpCode\`   | Abre tu app autenticadora e ingresa el código      |
| \`SMS_OTP\`            | \`smsCode\`    | Ingresa el código de 6 dígitos que llegó a tu SMS  |

Se requiere enviar **exactamente uno** de los dos campos (\`totpCode\` o \`smsCode\`).`,
      requestBody: jsonBody('VerifyMfaRequest'),
      responses: {
        200: commonResponses.ok(
          {
            oneOf: [{ $ref: '#/components/schemas/LoginResponse' }, { $ref: '#/components/schemas/PolicyUpdateRequiredResponse' }]
          },
          'MFA verificado. Sesión iniciada, o política desactualizada.'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.Forbidden,
        ...commonResponses.Unauthorized,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/auth/refresh ─────────────────────────
  '/client/api/v1/auth/refresh': {
    post: {
      tags: ['Auth'],
      summary: 'Renovar access token',
      operationId: 'refreshToken',
      security: [],
      description:
        'El refresh token se rota en cada uso: el JTI anterior se revoca y se emite uno nuevo. **El access token anterior también se invalida** (prevalece el nuevo par de tokens).\n\n' +
        '**Llamadas concurrentes.** Durante 60 s tras una rotación, cualquier llamada que llegue con el refresh token ya consumido recibe **el mismo par emitido** (200), no un error. Esto permite que un cliente web con varias pantallas montando a la vez dispare varios refresh sin romper la sesión. Pasada esa ventana, reusar un refresh token ya consumido se trata como reutilización maliciosa y **cierra todas las sesiones del usuario** (401 `SESSION_COMPROMISED`).\n\n' +
        '**Límites.** 30 renovaciones por sesión cada 15 minutos (429), y una sola renovación en vuelo por sesión (las simultáneas reciben 409 `REQUEST_IN_PROGRESS`). Ambos se cuentan **por sesión**, no por IP, y los dos son temporales (`retryable: true`, con `Retry-After`).\n\n' +
        '**Recomendación de integración:** mantener un único refresh en vuelo y encolar el resto de peticiones detrás de él; reintentar el 429 y el 409 después de `Retry-After`, nunca tratarlos como cierre de sesión.',
      parameters: toParameters(RefreshTokenHeaders, 'header'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/AuthTokens' }, 'Tokens renovados exitosamente.'),
        ...commonResponses.Unauthorized,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.RequestInProgress,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/auth/logout ──────────────────────────
  '/client/api/v1/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Cerrar sesión del dispositivo actual',
      operationId: 'logout',
      description:
        'Cierra la sesión actual: invalida el access token en Redis, revoca el refresh token y registra el cierre en BD.',
      responses: {
        200: commonResponses.ok({ type: 'object', nullable: true }, 'Sesión cerrada exitosamente.'),
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/auth/logout-all ──────────────────────
  '/client/api/v1/auth/logout-all': {
    post: {
      tags: ['Auth'],
      summary: 'Cerrar sesión en todos los dispositivos',
      operationId: 'logoutAll',
      description:
        'Invalida todos los tokens del usuario: invalidación masiva en Redis (blacklist) y cierre de todas las sesiones en BD. El usuario debe volver a hacer login en cada dispositivo.',
      responses: {
        200: commonResponses.ok({ type: 'object', nullable: true }, 'Sesión cerrada en todos los dispositivos.'),
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/auth/logout-others ───────────────────
  '/client/api/v1/auth/logout-others': {
    post: {
      tags: ['Auth'],
      summary: 'Cerrar todas las sesiones excepto la actual',
      operationId: 'logoutOthers',
      description:
        'Cierra todas las sesiones activas del usuario **excepto la sesión actual**. Por cada sesión cerrada se revoca el refresh token y se **invalida su access token de inmediato** (vía umbral por sesión en Redis), por lo que dejan de funcionar al instante, sin esperar a su expiración natural.',
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/OtherSessionsClosed' },
          'Todas las demás sesiones han sido cerradas.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── DELETE /client/api/v1/auth/sessions/:sessionId ───────────
  '/client/api/v1/auth/sessions/{sessionId}': {
    delete: {
      tags: ['Auth'],
      summary: 'Cerrar una sesión específica',
      operationId: 'closeSession',
      description:
        'Cierra una sesión activa específica del usuario **que no sea la sesión actual**. Revoca su refresh token e **invalida su access token de inmediato** (umbral por sesión en Redis), por lo que esa sesión deja de funcionar al instante. Para cerrar la sesión actual usa `/auth/logout`.',
      parameters: toParameters(SessionIdParams, 'path'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/SessionClosed' }, 'Sesión cerrada exitosamente.'),
        ...commonResponses.BadRequest,
        ...commonResponses.NotFound,
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── GET /client/api/v1/auth/devices ──────────────────────────
  '/client/api/v1/auth/devices': {
    get: {
      tags: ['Auth - Devices'],
      summary: 'Listar dispositivos del usuario',
      operationId: 'getTrustedDevices',
      description:
        'Devuelve todos los dispositivos del usuario (trusted, pending y blocked) con su **última sesión** (`activeSession`), que puede estar activa o cerrada — una sesión cerrada no desaparece, se muestra con su `status` y su último acceso (`startedAt`). El campo `isCurrent` indica el dispositivo que hace la solicitud y cuya sesión sigue activa.',
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/TrustedDeviceList' }, 'Dispositivos obtenidos exitosamente.'),
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── GET /client/api/v1/auth/devices/pending ──────────────────
  '/client/api/v1/auth/devices/pending': {
    get: {
      tags: ['Auth - Devices'],
      summary: 'Listar dispositivos pendientes de aprobación',
      operationId: 'getPendingDevices',
      description:
        'Devuelve solo los dispositivos en estado `pending`. Útil para mostrar la notificación de aprobación desde un dispositivo trusted.',
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/TrustedDeviceList' }, 'Dispositivos pendientes obtenidos.'),
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── PATCH /client/api/v1/auth/devices/:deviceId ──────────────
  '/client/api/v1/auth/devices/{deviceId}': {
    patch: {
      tags: ['Auth - Devices'],
      summary: 'Renombrar dispositivo',
      operationId: 'renameDevice',
      parameters: toParameters(DeviceIdParams, 'path'),
      requestBody: jsonBody('RenameDeviceRequest'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/TrustedDeviceUpdate' }, 'Dispositivo renombrado.'),
        ...commonResponses.BadRequest,
        ...commonResponses.NotFound,
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/auth/devices/:deviceId/approve ───────
  '/client/api/v1/auth/devices/{deviceId}/approve': {
    post: {
      tags: ['Auth - Devices'],
      summary: 'Aprobar dispositivo pendiente',
      operationId: 'approveDevice',
      description:
        'Cambia el estado del dispositivo de `pending` a `trusted`. **Solo puede ejecutarse desde un dispositivo trusted.**',
      parameters: toParameters(DeviceIdParams, 'path'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/TrustedDeviceUpdate' }, 'Dispositivo aprobado.'),
        ...commonResponses.BadRequest,
        ...commonResponses.NotFound,
        ...commonResponses.Forbidden,
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/auth/devices/:deviceId/block ─────────
  '/client/api/v1/auth/devices/{deviceId}/block': {
    post: {
      tags: ['Auth - Devices'],
      summary: 'Bloquear dispositivo',
      operationId: 'blockDevice',
      description:
        'Bloquea un dispositivo (trusted o pending). **Solo puede ejecutarse desde un dispositivo trusted. No se puede bloquear el único dispositivo trusted del usuario.**',
      parameters: toParameters(DeviceIdParams, 'path'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/TrustedDeviceUpdate' }, 'Dispositivo bloqueado.'),
        ...commonResponses.BadRequest,
        ...commonResponses.NotFound,
        ...commonResponses.Forbidden,
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/auth/devices/:deviceId/unblock ───────
  '/client/api/v1/auth/devices/{deviceId}/unblock': {
    post: {
      tags: ['Auth - Devices'],
      summary: 'Desbloquear dispositivo',
      operationId: 'unblockDevice',
      description:
        'Cambia el estado del dispositivo de `blocked` a `pending` (requiere nueva aprobación). **Solo puede ejecutarse desde un dispositivo trusted.**',
      parameters: toParameters(DeviceIdParams, 'path'),
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/TrustedDeviceUpdate' },
          'Dispositivo desbloqueado. Queda en estado pending hasta ser aprobado.'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.NotFound,
        ...commonResponses.Forbidden,
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
