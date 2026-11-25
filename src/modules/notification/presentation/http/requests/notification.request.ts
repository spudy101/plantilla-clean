// Entrada del módulo de notificaciones: bandeja del usuario, preferencias, verificación de contacto y
// administración (categorías, tipos, entregas).
import { z, withHint } from '../../../../../shared/presentation/validation/z';
import {
  input,
  optionalBool,
  optionalInList,
  optionalIsoDate,
  optionalUuid,
  pageQuery,
  pagingQuery,
  searchQuery,
  uuid
} from '../../../../../shared/presentation/validation/fields';

const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;

const time = (field: string) =>
  withHint(
    z
      .string()
      .regex(TIME_REGEX, { error: `${field} debe tener formato HH:MM o HH:MM:SS` })
      .nullish(),
    { hint: 'Ingresá la hora en formato HH:MM' }
  );
const bodyBool = (field: string) => optionalBool(field);

// ── Bandeja del usuario ───────────────────────────────────────
const byCreatedAt = pageQuery(['createdAt'], { sortBy: 'createdAt' });
/** Bandeja mezclada (personales + globales), por fecha. */
export const NotificationFeedQuery = z.object(byCreatedAt);
export type NotificationFeedQuery = z.output<typeof NotificationFeedQuery>;
/** Solo personales: por fecha, con búsqueda en título y cuerpo. */
export const PersonalNotificationListQuery = z.object({ ...byCreatedAt, ...searchQuery });
export type PersonalNotificationListQuery = z.output<typeof PersonalNotificationListQuery>;
/** Solo globales: orden fijo (más reciente primero). */
export const GlobalNotificationListQuery = z.object(pagingQuery);
export type GlobalNotificationListQuery = z.output<typeof GlobalNotificationListQuery>;

// ── Creación por un servicio externo (X-API-Key) ──────────────
export const CreateNotificationBody = input({
  tipoNotificacion: withHint(
    z.string({ error: 'tipoNotificacion es requerido' }).trim().min(1, { error: 'tipoNotificacion es requerido' }),
    {
      hint: 'Indicá el código del tipo de notificación (notification_types.code)'
    }
  ).meta({ example: 'OPERATION_APPROVED' }),
  userId: optionalUuid('El usuario destinatario').meta({
    description: 'Usuario destinatario. Sin userId la notificación es global (para todos).'
  }),
  relatedEntity: z
    .object({ type: z.string().nullish(), id: z.string().nullish() })
    .nullish()
    .meta({ description: 'Entidad relacionada (ej: { type: "operation", id: "<uuid>" }).' }),
  metadata: z
    .record(z.string(), z.unknown())
    .nullish()
    .meta({ description: 'Variables de las plantillas del tipo (ej: { nombre, monto }).' })
});

// ── Preferencias ──────────────────────────────────────────────
const EDITABLE_FIELDS = ['allowPush', 'allowEmail', 'allowSms', 'quietHoursStart', 'quietHoursEnd'] as const;
export const UpdatePreferenceBody = input({
  allowPush: bodyBool('allowPush'),
  allowEmail: bodyBool('allowEmail'),
  allowSms: bodyBool('allowSms'),
  quietHoursStart: time('quietHoursStart'),
  quietHoursEnd: time('quietHoursEnd')
}).refine(v => EDITABLE_FIELDS.some(f => (v as Record<string, unknown>)[f] !== undefined), {
  error: 'Debe enviar al menos un campo para actualizar las preferencias'
});

// ── Verificación de email / teléfono ──────────────────────────
const verificationType = withHint(
  z
    .string({ error: 'El tipo de verificación es requerido' })
    .trim()
    .min(1, { error: 'El tipo de verificación es requerido' })
    .pipe(z.enum(['email', 'phone'], { error: 'Tipo de verificación inválido. Debe ser email o phone' })),
  { hint: 'Indicá email o phone' }
);
const contact = (max?: number) =>
  withHint(
    max === undefined
      ? z.string({ error: 'El contacto es requerido' }).trim().min(1, { error: 'El contacto es requerido' })
      : z
          .string({ error: 'El contacto es requerido' })
          .trim()
          .min(1, { error: 'El contacto es requerido' })
          .max(max, { error: `El contacto admite máximo ${max} caracteres` }),
    { hint: 'Ingresá el email o teléfono a verificar' }
  );

export const SendVerificationBody = input({
  type: verificationType,
  contact: contact(100),
  phonePrefixId: z.unknown().optional()
}).superRefine((v, ctx) => {
  if (v.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.contact)) {
    ctx.addIssue({ code: 'custom', path: ['contact'], message: 'Debe ser un email válido' });
  }
  if (v.type === 'phone') {
    if (!/^\d{7,15}$/.test(v.contact)) {
      ctx.addIssue({ code: 'custom', path: ['contact'], message: 'Debe ser un número de teléfono válido (7-15 dígitos)' });
    }
    const prefix = uuid('phonePrefixId').safeParse(v.phonePrefixId);
    if (!prefix.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['phonePrefixId'],
        message:
          v.phonePrefixId === undefined || v.phonePrefixId === ''
            ? 'phonePrefixId es requerido cuando el tipo es phone'
            : 'phonePrefixId debe ser un UUID válido'
      });
    }
  }
});

export const VerifyCodeBody = input({
  type: verificationType,
  contact: contact(),
  code: withHint(
    z
      .string({ error: 'El código es requerido' })
      .trim()
      .min(1, { error: 'El código es requerido' })
      .min(4, { error: 'El código debe tener entre 4 y 8 caracteres' })
      .max(8, { error: 'El código debe tener entre 4 y 8 caracteres' }),
    { hint: 'Ingresá el código que recibiste, entre 4 y 8 caracteres' }
  )
});

// ── Categorías (admin) ────────────────────────────────────────
const byNameOrCode = pageQuery(['createdAt', 'name', 'code'], { sortBy: 'createdAt' });
export const CategoryListQuery = z.object({
  ...byNameOrCode,
  ...searchQuery,
  isActive: optionalBool('El estado'),
  isCritical: optionalBool('La criticidad')
});
export type CategoryListQuery = z.output<typeof CategoryListQuery>;
export const CategoryIdParams = input({ notificationCategoryId: uuid('La categoría de notificación') });

const editableCategory = {
  description: z.string().trim().max(1000).nullish(),
  supportsPush: bodyBool('supportsPush'),
  supportsEmail: bodyBool('supportsEmail'),
  supportsSms: bodyBool('supportsSms'),
  isCritical: bodyBool('isCritical'),
  emailLayoutTemplate: z.string().max(20000).nullish(),
  isActive: bodyBool('isActive')
};
export const CreateCategoryBody = input({
  code: withHint(
    z
      .string({ error: 'code es requerido' })
      .trim()
      .min(1, { error: 'code es requerido' })
      .regex(/^[A-Z0-9_]{2,100}$/, { error: 'code debe ser MAYÚSCULAS/números/guion bajo (2-100)' }),
    { hint: 'Ej: COMMERCIAL, SECURITY' }
  ),
  name: z
    .string({ error: 'name es requerido' })
    .trim()
    .min(2, { error: 'name debe tener entre 2 y 200 caracteres' })
    .max(200, { error: 'name debe tener entre 2 y 200 caracteres' }),
  ...editableCategory
});
export const UpdateCategoryBody = input({
  name: z
    .string()
    .trim()
    .min(2, { error: 'name debe tener entre 2 y 200 caracteres' })
    .max(200, { error: 'name debe tener entre 2 y 200 caracteres' })
    .optional(),
  ...editableCategory
});

// ── Tipos de notificación (admin) ─────────────────────────────
export const TypeListQuery = z.object({
  ...byNameOrCode,
  ...searchQuery,
  isActive: optionalBool('El estado'),
  notificationCategoryId: optionalUuid('notificationCategoryId')
});
export type TypeListQuery = z.output<typeof TypeListQuery>;
export const TypeIdParams = input({ notificationTypeId: uuid('El tipo de notificación') });
export const UpdateTypeBody = input({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  notificationCategoryId: withHint(z.uuid({ error: 'notificationCategoryId debe ser un UUID válido' }).nullish(), {
    hint: 'Usá el identificador de la categoría (formato UUID)'
  })
});

const lengthBetween = (field: string, min: number, max?: number) => {
  const range = max === undefined ? `al menos ${min} caracteres` : `entre ${min} y ${max} caracteres`;
  let schema = z
    .string({ error: `${field} es requerido` })
    .trim()
    .min(1, { error: `${field} es requerido` })
    .min(min, { error: `${field} debe tener ${range}` });
  if (max !== undefined) {
    schema = schema.max(max, { error: `${field} debe tener ${range}` });
  }
  return withHint(schema, {
    hint: max === undefined ? `Usá al menos ${min} caracteres` : `Usá entre ${min} y ${max} caracteres`
  });
};
const globalNotification = {
  titulo: lengthBetween('titulo', 3, 255),
  contenido: lengthBetween('contenido', 3),
  asunto: lengthBetween('asunto', 3, 255)
};
export const GlobalNotificationBody = input(globalNotification);
export const DirectNotificationBody = input({
  userId: withHint(
    z.uuid({
      error: issue => (issue.input === undefined || issue.input === '' ? 'userId es requerido' : 'userId debe ser un UUID válido')
    }),
    { hint: 'Indicá el UUID del usuario destinatario' }
  ),
  ...globalNotification
});

// ── Entregas (admin, solo consulta) ───────────────────────────
const DELIVERY_STATUSES = ['pending', 'sent', 'failed', 'skipped'];
const DELIVERY_CHANNELS = ['push', 'email', 'sms'];
export const DeliveryListQuery = z.object({
  ...pageQuery(['createdAt'], { sortBy: 'createdAt' }),
  status: optionalInList(DELIVERY_STATUSES, {
    message: `status debe ser: ${DELIVERY_STATUSES.join(', ')}`,
    hint: `Indicá uno de los valores: ${DELIVERY_STATUSES.join(', ')}`
  }),
  channel: optionalInList(DELIVERY_CHANNELS, {
    message: `channel debe ser: ${DELIVERY_CHANNELS.join(', ')}`,
    hint: `Indicá uno de los valores: ${DELIVERY_CHANNELS.join(', ')}`
  }),
  userId: optionalUuid('El ID de usuario'),
  from: optionalIsoDate('from'),
  to: optionalIsoDate('to')
});
export type DeliveryListQuery = z.output<typeof DeliveryListQuery>;
export const DeliveryIdParams = input({ id: uuid('La entrega') });
