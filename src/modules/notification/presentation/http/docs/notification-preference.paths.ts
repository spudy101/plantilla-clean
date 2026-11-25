import commonResponses from '../../../../../shared/presentation/openapi/common.responses';
import { jsonBody, toOpenApi } from '../../../../../shared/presentation/validation/openapi';
import { UpdatePreferenceBody } from '../requests/notification.request';
import { NotificationPreferenceSchema } from '../responses/notification-preference.response';

/**
 * ============================================================
 * NOTIFICATION PREFERENCE PATHS — SHARED ENDPOINTS
 * ============================================================
 * Una sola preferencia por usuario: qué canales externos acepta (push/email/sms) y su horario de
 * silencio. Las categorías críticas (seguridad, emergencia) la ignoran. Requieren autenticación.
 *
 * Rutas:
 *   GET /notifications/preferences → la preferencia (o los valores por defecto)
 *   PUT /notifications/preferences → crear o actualizar
 */

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  UpdatePreferenceRequest: toOpenApi(UpdatePreferenceBody),
  NotificationPreference: toOpenApi(NotificationPreferenceSchema, 'output')
};

const paths = {
  '/client/api/v1/kyc/person/notifications/preferences': {
    get: {
      tags: ['Notification Preferences'],
      summary: 'Obtener la preferencia de notificaciones del usuario',
      operationId: 'getNotificationPreferences',
      description: [
        'Devuelve la preferencia del usuario autenticado. Si nunca la configuró, `configured: false` y los',
        'valores por defecto (todos los canales permitidos, sin horario de silencio).',
        '',
        'Las notificaciones de categorías **críticas** (seguridad, emergencia) llegan siempre, sin importar',
        'esta preferencia.'
      ].join('\n'),
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/NotificationPreference' },
          'Preferencias de notificación obtenidas exitosamente.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    },
    put: {
      tags: ['Notification Preferences'],
      summary: 'Actualizar la preferencia de notificaciones del usuario',
      operationId: 'updateNotificationPreferences',
      description: [
        'Crea o actualiza la preferencia del usuario autenticado con los campos enviados.',
        '',
        '**Horario de silencio:** con `quietHoursStart` y `quietHoursEnd`, el envío por push/email/SMS se',
        'difiere al final del horario (la notificación in-app se crea igual). Soporta rangos que cruzan',
        'medianoche. Para desactivarlo, enviar `null` en ambos.',
        '',
        '⚠️ Al menos uno de los campos (`allowPush`, `allowEmail`, `allowSms`, `quietHoursStart`,',
        '`quietHoursEnd`) debe estar presente.'
      ].join('\n'),
      requestBody: jsonBody('UpdatePreferenceRequest'),
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/NotificationPreference' },
          'Preferencias de notificación actualizadas exitosamente.'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
