import type { NotificationType } from '../../../shared/infrastructure/database/generated/prisma/client';
// ============================================================
// NOTIFICATION CONTENT UTIL
// ============================================================
// Funciones puras para generación de contenido y prioridades.
// Absorbe notificationPriority.util.js — sin lógica de negocio,
// sin repositorios, reutilizable en cualquier contexto.

class NotificationContentUtil {
  // ============================================================
  // CONTENT GENERATION
  // ============================================================

  /**
   * Genera título y cuerpo usando templates del notification_type
   * @param {Object} notificationType - Tipo de notificación con templates
   * @param {Object} metadata         - Datos para reemplazar variables
   * @returns {{ title, body, emailSubject, emailBody }}
   */
  static generarContenido(
    notificationType: Pick<
      NotificationType,
      'titleTemplate' | 'bodyTemplate' | 'emailSubjectTemplate' | 'emailBodyTemplate'
    >,
    metadata: unknown
  ) {
    const title = this.reemplazarVariables(notificationType.titleTemplate, metadata);
    const body = this.reemplazarVariables(notificationType.bodyTemplate, metadata);

    let emailSubject = '';
    let emailBody = '';

    if (notificationType.emailSubjectTemplate) {
      emailSubject = this.reemplazarVariables(notificationType.emailSubjectTemplate, metadata);
    }

    if (notificationType.emailBodyTemplate) {
      emailBody = this.reemplazarVariables(notificationType.emailBodyTemplate, metadata);
    }

    return { title, body, emailSubject, emailBody };
  }

  /**
   * Reemplaza variables {{variable}} con valores de metadata
   * @param {string} template - Template con variables
   * @param {Object} data     - Datos para reemplazar
   * @returns {string}
   */
  static reemplazarVariables(template: string | null | undefined, data: unknown) {
    if (!template) {
      return '';
    }

    return template.replaceAll(/\{\{(\w+)\}\}/g, (match: string, variable: string) => {
      const value = (data as Record<string, unknown> | null | undefined)?.[variable];
      return value === null || value === undefined ? match : String(value);
    });
  }
}

export default NotificationContentUtil;
