// El email de un tipo de notificación: asunto y cuerpo desde sus plantillas, envuelto en el layout de su
// categoría. Los adjuntos viajan en metadata.attachments (son del envío, no del tipo).
import { categorySupports, renderTemplate, type CategoryRules, type NotificationType } from './notification-type';

/** Lo que el email lee del tipo: sus plantillas y la categoría (canal + layout). */
export type EmailTemplateSource = Pick<NotificationType, 'code' | 'emailSubjectTemplate' | 'emailBodyTemplate'> & {
  category?: CategoryRules | null;
};

export type ComposedEmail =
  | { status: 'ready'; subject: string; html: string }
  /** La categoría no admite email, o el tipo no tiene plantillas de email: no se envía. */
  | { status: 'unsupported'; reason: 'channel' | 'templates' };

/**
 * Envuelve el contenido (fragmento) en el layout de la categoría, que lo recibe en {{content}}. Si no hay layout,
 * o el contenido ya es un documento HTML completo (los templates heredados lo son), va tal cual.
 */
export function wrapInLayout(content: string, layout: string | null | undefined, data: unknown): string {
  if (!layout || /<!doctype|<html/i.test(content)) {
    return content;
  }
  // split/join y no replace: un '$' del contenido no se interpreta. Después, las variables del layout ({{logoUrl}}).
  return renderTemplate(layout.split('{{content}}').join(content), data);
}

export function composeEmail(type: EmailTemplateSource, data: Record<string, unknown>): ComposedEmail {
  const category = type.category ?? null;
  if (!categorySupports(category, 'email')) {
    return { status: 'unsupported', reason: 'channel' };
  }
  if (!type.emailSubjectTemplate || !type.emailBodyTemplate) {
    return { status: 'unsupported', reason: 'templates' };
  }
  return {
    status: 'ready',
    subject: renderTemplate(type.emailSubjectTemplate, data),
    html: wrapInLayout(renderTemplate(type.emailBodyTemplate, data), category?.emailLayoutTemplate, data)
  };
}
