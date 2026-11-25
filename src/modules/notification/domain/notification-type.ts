// Tipos y categorías de notificación: qué dice cada aviso (plantillas) y por dónde sale (la categoría).
//
// La CATEGORÍA es la fuente de verdad de los canales (push/email/sms), de la criticidad (una crítica se envía
// siempre, sin mirar preferencias ni horario de silencio) y del layout del email. El TIPO tiene las plantillas
// ({{variable}}) y apunta a su categoría.

export type Channel = 'push' | 'email' | 'sms';

/** Orden en que se crean (y se intentan) las entregas de una notificación. */
export const CHANNELS: readonly Channel[] = ['push', 'email', 'sms'];

/** Soporte por defecto si la categoría no lo declara (o el tipo no tiene categoría). */
const SUPPORTED_BY_DEFAULT: Record<Channel, boolean> = { push: true, email: true, sms: false };

export interface NotificationCategory {
  notificationCategoryId: string;
  code: string;
  name: string;
  description: string | null;
  supportsPush: boolean;
  supportsEmail: boolean;
  supportsSms: boolean;
  isCritical: boolean;
  emailLayoutTemplate: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationType {
  notificationTypeId: string;
  code: string;
  name: string;
  description: string | null;
  notificationCategoryId: string | null;
  titleTemplate: string;
  bodyTemplate: string;
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
  isActive: boolean | null;
  createdAt: Date;
  updatedAt: Date;
  /** null si no tiene categoría (o si la lectura no la trajo). */
  category: NotificationCategory | null;
}

/** Lo que el envío lee de la categoría: canales, criticidad y layout. */
export type CategoryRules = Partial<
  Pick<NotificationCategory, 'supportsPush' | 'supportsEmail' | 'supportsSms' | 'isCritical' | 'emailLayoutTemplate'>
>;

const supportsKey = { push: 'supportsPush', email: 'supportsEmail', sms: 'supportsSms' } as const;

/** ¿La categoría deja salir el canal? Sin categoría (o sin el dato), el soporte por defecto. */
export function categorySupports(category: CategoryRules | null | undefined, channel: Channel): boolean {
  return category?.[supportsKey[channel]] ?? SUPPORTED_BY_DEFAULT[channel];
}

/** Crítica: se envía siempre, sin mirar preferencias ni horario de silencio. */
export const isCritical = (category: CategoryRules | null | undefined): boolean => category?.isCritical === true;

// ── Plantillas ────────────────────────────────────────────────

/** Reemplaza {{variable}} con los valores de `data`; una variable sin valor queda como estaba. */
export function renderTemplate(template: string | null | undefined, data: unknown): string {
  if (!template) {
    return '';
  }
  return template.replaceAll(/\{\{(\w+)\}\}/g, (match: string, variable: string) => {
    const value = (data as Record<string, unknown> | null | undefined)?.[variable];
    return value === null || value === undefined ? match : String(value);
  });
}

/** Título y cuerpo de la notificación in-app (y de push/SMS) a partir de las plantillas del tipo. */
export function renderContent(type: Pick<NotificationType, 'titleTemplate' | 'bodyTemplate'>, metadata: unknown) {
  return { title: renderTemplate(type.titleTemplate, metadata), body: renderTemplate(type.bodyTemplate, metadata) };
}

// ── Edición desde el panel ────────────────────────────────────

/** Campos de la categoría que el panel puede escribir. */
export const CATEGORY_EDITABLE_FIELDS = [
  'name',
  'description',
  'supportsPush',
  'supportsEmail',
  'supportsSms',
  'isCritical',
  'emailLayoutTemplate',
  'isActive'
] as const;

export type CategoryChanges = Partial<Pick<NotificationCategory, (typeof CATEGORY_EDITABLE_FIELDS)[number]>>;
export type NewCategory = CategoryChanges & { code: string; name: string };

/** Los campos de tipo que el panel puede escribir. Plantillas, canales y criticidad no: viven en otro lado. */
export const TYPE_EDITABLE_FIELDS = ['name', 'description', 'notificationCategoryId'] as const;

export type TypeChanges = Partial<Pick<NotificationType, (typeof TYPE_EDITABLE_FIELDS)[number]>>;

/** Solo los campos permitidos que vienen en la entrada (undefined = no se toca). */
function pickDefined<K extends string>(input: Record<string, unknown>, keys: readonly K[]): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {};
  for (const key of keys) {
    if (input[key] !== undefined) {
      out[key] = input[key];
    }
  }
  return out;
}

export const categoryChanges = (input: Record<string, unknown>): CategoryChanges =>
  pickDefined(input, CATEGORY_EDITABLE_FIELDS) as CategoryChanges;

export const typeChanges = (input: Record<string, unknown>): TypeChanges => pickDefined(input, TYPE_EDITABLE_FIELDS) as TypeChanges;

/** El código de una categoría se guarda en mayúsculas y sin espacios alrededor. */
export const normalizeCategoryCode = (code: string): string => code.trim().toUpperCase();
