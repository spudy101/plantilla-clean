// Bandeja, preferencias, panel admin, verificación de contacto, feed de rebotes y retención, con dobles en memoria.
import { GetUnreadCount, ListGlobalNotifications, ListNotificationFeed, ListPersonalNotifications } from './inbox.use-cases';
import { UnreadCounter } from './unread-counter';
import { GetNotificationPreference, UpdateNotificationPreference } from './preferences.use-cases';
import {
  CreateNotificationCategory,
  DeleteNotificationCategory,
  ListNotificationTypes,
  UpdateNotificationCategory,
  UpdateNotificationType
} from './notification-catalog.use-cases';
import { CreateExternalNotification, GetDelivery, ListDeliveries, SendDirectAnnouncement, SendGlobalAnnouncement } from './admin-notifications.use-cases';
import { SendVerificationCode, VerifyCode } from './verification-codes.use-cases';
import { ProcessBounceFeed } from './bounce-feed.use-case';
import { EmailSuppressionList } from './email-suppression.use-cases';
import { PurgeOldNotifications, PurgeVerificationCodes } from './cleanup.use-cases';
import { SmsSender } from './sms-sender';
import type { CreateNotificationInput } from './create-notification.use-case';
import {
  CategoryCodeTakenError,
  CategoryInUseError,
  CodeAlreadyUsedError,
  CodeRequestTooSoonError,
  DeliveryNotFoundError,
  InactiveRecipientError,
  InvalidFeedSignatureError,
  UnauthorizedTopicError,
  UnknownCategoryError
} from '../../domain/errors';
import {
  ADMIN_ID,
  FakeFeedVerifier,
  FakeRecipients,
  FakeSmsGateway,
  FakeUnreadChannel,
  ID,
  InMemoryCategories,
  InMemoryDeliveries,
  InMemoryGlobalNotifications,
  InMemoryNotificationTypes,
  InMemoryPersonalNotifications,
  InMemoryPreferences,
  InMemoryPushTokens,
  InMemorySuppressions,
  InMemoryVerificationCodes,
  USER_ID,
  category,
  deliveryRecord,
  fakeCipher,
  fakePrefixes,
  fixedCodes,
  flushBackground,
  globalNotification,
  personalNotification,
  recipient,
  verificationCode
} from '../../../../../tests/doubles/notification.doubles';
import { CountingUnitOfWork } from '../../../../../tests/doubles/legal.doubles';
import { RecordingAuditTrail, silentLogger } from '../../../../../tests/doubles/settings.doubles';

const query = { page: 1, limit: 10, sortBy: 'createdAt' as const, order: 'DESC' as const };

/** Quien crea notificaciones (CreateNotification), grabando lo pedido. */
class RecordingCreate {
  readonly calls: CreateNotificationInput[] = [];
  async execute(input: CreateNotificationInput) {
    this.calls.push(input);
    return input.userId
      ? { estadoSolicitud: 1 as const, message: 'ok', notificationId: 'n-1' }
      : { estadoSolicitud: 1 as const, message: 'ok', globalNotificationId: 'g-1' };
  }
}

describe('bandeja del usuario', () => {
  function setup() {
    const personal = new InMemoryPersonalNotifications([
      personalNotification({ notificationId: 'p-1', createdAt: new Date(1) }),
      personalNotification({ notificationId: 'p-2', createdAt: new Date(3), isRead: true })
    ]);
    const globals = new InMemoryGlobalNotifications([globalNotification({ globalNotificationId: 'g-1', createdAt: new Date(2) })]);
    const channel = new FakeUnreadChannel();
    const audit = new RecordingAuditTrail();
    const unread = new UnreadCounter(personal, globals, channel, silentLogger);
    return { personal, globals, channel, audit, unread };
  }

  it('la mezclada: personales y globales por fecha, la página queda leída y el contador se refresca', async () => {
    const t = setup();
    const feed = new ListNotificationFeed(t.personal, t.globals, new CountingUnitOfWork(), t.unread, t.audit, silentLogger);
    const result = await feed.execute({ userId: USER_ID, query });

    expect(result.data.map(item => [item.type, item.isRead])).toEqual([
      ['personal', true],
      ['global', false],
      ['personal', false]
    ]);
    expect(result.metadata).toMatchObject({ pagination: { totalItems: 3 } });
    expect(t.personal.notifications.every(n => n.isRead)).toBe(true);
    expect(await t.globals.readIdsOf(USER_ID)).toEqual(['g-1']);
    expect(t.audit.entries[0]).toMatchObject({ action: 'NOTIFICATION_LIST_VIEWED', actorId: USER_ID, details: { totalItems: 3, page: 1 } });

    await flushBackground();
    expect(t.channel.published).toContainEqual({ userId: USER_ID, count: 0 });
  });

  it('solo personales y solo globales (orden fijo, la más reciente primero)', async () => {
    const t = setup();
    const personal = await new ListPersonalNotifications(t.personal, t.unread, t.audit).execute({ userId: USER_ID, query: { ...query, search: null } });
    expect(personal.data.map(n => n.notificationId)).toEqual(['p-1', 'p-2']);
    expect(t.personal.notifications.find(n => n.notificationId === 'p-1')!.isRead).toBe(true);

    const global = await new ListGlobalNotifications(t.globals, t.unread, t.audit).execute({ userId: USER_ID, query: { page: 1, limit: 10 } });
    expect(global.data).toEqual([expect.objectContaining({ globalNotificationId: 'g-1', isRead: false })]);
    expect(t.audit.entries.map(e => [e.action, e.entityType])).toEqual([
      ['NOTIFICATION_PERSONAL_LIST_VIEWED', 'Notification'],
      ['NOTIFICATION_GLOBAL_LIST_VIEWED', 'GlobalNotification']
    ]);
  });

  it('el contador: personales + globales sin leer, publicado y auditado', async () => {
    const t = setup();
    await expect(new GetUnreadCount(t.unread, t.channel, t.audit).execute(USER_ID)).resolves.toBe(2);
    expect(t.channel.published).toEqual([{ userId: USER_ID, count: 2 }]);
    expect(t.audit.entries[0]).toMatchObject({ action: 'NOTIFICATION_UNREAD_COUNT_VIEWED', details: { count: 2 } });
  });
});

describe('preferencias', () => {
  it('sin configurar: los valores por defecto; al cambiar, solo lo enviado', async () => {
    const preferences = new InMemoryPreferences();
    const audit = new RecordingAuditTrail();
    await expect(new GetNotificationPreference(preferences, audit).execute(USER_ID)).resolves.toMatchObject({ configured: false, allowPush: true });

    const updated = await new UpdateNotificationPreference(preferences, audit).execute({
      userId: USER_ID,
      changes: { allowSms: false, quietHoursStart: '22:00', allowPush: undefined }
    });
    expect(preferences.upserts[0]!.changes).toEqual({ allowSms: false, quietHoursStart: '22:00' });
    expect(updated).toMatchObject({ configured: true, allowSms: false });
    expect(audit.entries[1]).toMatchObject({ action: 'NOTIFICATION_GLOBAL_PREFERENCE_UPDATED', details: { allowSms: false, quietHoursStart: '22:00' } });
  });
});

describe('panel: categorías y tipos', () => {
  it('crear: código normalizado y único', async () => {
    const categories = new InMemoryCategories();
    const audit = new RecordingAuditTrail();
    const create = new CreateNotificationCategory(categories, audit);
    await expect(create.execute({ actorId: ADMIN_ID, data: { code: ' security ', name: 'Otra' } })).rejects.toThrow(CategoryCodeTakenError);

    const created = await create.execute({ actorId: ADMIN_ID, data: { code: 'promo', name: 'Promociones', isCritical: false } });
    expect(created).toMatchObject({ code: 'PROMO', name: 'Promociones', emailLayoutTemplate: expect.any(String) });
    expect(audit.entries[0]).toMatchObject({ action: 'NOTIFICATION_CATEGORY_CREATED', details: { code: 'PROMO' } });
  });

  it('editar sin cambios no escribe ni audita; borrar con tipos asignados no se puede', async () => {
    const categories = new InMemoryCategories();
    const audit = new RecordingAuditTrail();
    await new UpdateNotificationCategory(categories, audit).execute({ actorId: ADMIN_ID, notificationCategoryId: ID, data: { code: 'X' } });
    expect(audit.entries).toEqual([]);

    const remove = new DeleteNotificationCategory(categories, new InMemoryNotificationTypes(), audit);
    await expect(remove.execute({ actorId: ADMIN_ID, notificationCategoryId: ID })).rejects.toThrow(CategoryInUseError);
    await expect(
      new DeleteNotificationCategory(categories, new InMemoryNotificationTypes([]), audit).execute({ actorId: ADMIN_ID, notificationCategoryId: ID })
    ).resolves.toEqual({ notificationCategoryId: ID, deleted: true });
  });

  it('tipos: listado con plantillas; reasignar a una categoría que no existe falla', async () => {
    const types = new InMemoryNotificationTypes();
    const audit = new RecordingAuditTrail();
    const list = await new ListNotificationTypes(types, audit).execute({ actorId: ADMIN_ID, query: { ...query, isActive: true } });
    expect(list.data[0]).toMatchObject({ code: 'OPERATION_APPROVED', titleTemplate: 'Hola {{nombre}}', category: { code: 'SECURITY' } });
    expect(list.metadata).toMatchObject({ pagination: { totalItems: 1 } });

    const update = new UpdateNotificationType(types, new InMemoryCategories([category()]), audit);
    await expect(update.execute({ actorId: ADMIN_ID, notificationTypeId: ID, data: { notificationCategoryId: 'otra' } })).rejects.toThrow(
      UnknownCategoryError
    );
    await expect(update.execute({ actorId: ADMIN_ID, notificationTypeId: ID, data: { name: 'Nuevo' } })).resolves.toMatchObject({ name: 'Nuevo' });
    expect(audit.entries.at(-1)).toMatchObject({ action: 'NOTIFICATION_TYPE_UPDATED', details: { updatedFields: ['name'] } });
  });
});

describe('panel: avisos, creación externa y entregas', () => {
  it('aviso a todos y a un usuario activo (NOTIFICACION_GENERAL con el logo)', async () => {
    const create = new RecordingCreate();
    const audit = new RecordingAuditTrail();
    const announcement = { titulo: 'Hola', contenido: 'Texto', asunto: 'Asunto' };

    const global = await new SendGlobalAnnouncement(create, audit, 'https://logo').execute({ actorId: ADMIN_ID, announcement });
    expect(global).toMatchObject({ globalNotificationId: 'g-1', processingStatus: 'queued' });
    expect(create.calls[0]).toEqual({
      type: 'NOTIFICACION_GENERAL',
      userId: null,
      relatedEntity: null,
      metadata: { ...announcement, logoUrl: 'https://logo' }
    });

    const recipients = new FakeRecipients([recipient(), recipient({ userId: 'u-off', isActive: false })]);
    const direct = new SendDirectAnnouncement(recipients, create, audit, null);
    await expect(direct.execute({ actorId: ADMIN_ID, announcement: { ...announcement, userId: USER_ID } })).resolves.toMatchObject({ notificationId: 'n-1' });
    await expect(direct.execute({ actorId: ADMIN_ID, announcement: { ...announcement, userId: 'u-off' } })).rejects.toThrow(InactiveRecipientError);
    await expect(direct.execute({ actorId: ADMIN_ID, announcement: { ...announcement, userId: 'nadie' } })).rejects.toThrow('Usuario no encontrado');
    expect(audit.entries.map(e => e.action)).toEqual(['GLOBAL_NOTIFICATION_SENT', 'DIRECT_NOTIFICATION_SENT']);
  });

  it('creación por un servicio externo: se audita sin actor, con el servicio', async () => {
    const create = new RecordingCreate();
    const audit = new RecordingAuditTrail();
    await new CreateExternalNotification(create, audit, silentLogger).execute({
      request: { tipoNotificacion: 'X', userId: USER_ID, metadata: { a: 1 } },
      externalService: 'erp'
    });
    expect(create.calls[0]).toEqual({ type: 'X', userId: USER_ID, metadata: { a: 1 } });
    expect(audit.entries[0]).toMatchObject({ action: 'NOTIFICATION_CREATED', actorId: null, details: { tipoNotificacion: 'X', externalService: 'erp' } });
  });

  it('entregas: listado con filtros y detalle con la metadata enmascarada', async () => {
    const deliveries = new InMemoryDeliveries();
    deliveries.records = [deliveryRecord()];
    const audit = new RecordingAuditTrail();
    const list = await new ListDeliveries(deliveries, audit).execute({ actorId: ADMIN_ID, query: { ...query, status: 'failed' } });
    expect(list).toMatchObject({ data: [{ notificationDeliveryId: ID, status: 'failed' }], metadata: { pagination: { totalItems: 1 } } });
    expect(deliveries.lastFilters).toEqual({ status: 'failed', channel: null, userId: null, from: null, to: null });

    const detail = await new GetDelivery(deliveries, audit).execute({ actorId: ADMIN_ID, notificationDeliveryId: ID });
    expect(detail.metadata).not.toEqual({ email: 'ana@correo.co' });
    await expect(new GetDelivery(deliveries, audit).execute({ actorId: ADMIN_ID, notificationDeliveryId: 'x' })).rejects.toThrow(DeliveryNotFoundError);
  });
});

describe('verificación de contacto', () => {
  function setup() {
    const codes = new InMemoryVerificationCodes();
    const audit = new RecordingAuditTrail();
    const emails: Array<{ type: string; email: string; metadata?: Record<string, unknown> }> = [];
    const smsGateway = new FakeSmsGateway();
    const send = new SendVerificationCode({
      codes,
      generator: fixedCodes('654321'),
      directEmail: { execute: async input => (emails.push(input), { estadoSolicitud: 1 as const, message: 'ok' }) },
      sms: new SmsSender(smsGateway, fakePrefixes),
      audit,
      logger: silentLogger,
      mockProviders: false,
      logoUrl: 'L'
    });
    return { codes, audit, emails, smsGateway, send, verify: new VerifyCode(codes, audit, silentLogger) };
  }

  it('pedir: espera mínima entre pedidos; el código sale por email (sin parcial) o SMS (con parcial)', async () => {
    const t = setup();
    t.codes.waitSeconds = 30;
    await expect(t.send.execute({ type: 'email', contact: 'a@x.co' })).rejects.toThrow(CodeRequestTooSoonError);
    t.codes.waitSeconds = 0;

    await expect(t.send.execute({ type: 'email', contact: 'a@x.co' })).resolves.toEqual({ verificationCodeId: 'vc-1', expiresAt: expect.any(Date) });
    await expect(t.send.execute({ type: 'phone', contact: '912345678', phonePrefixId: 'pref-cl' })).resolves.toMatchObject({
      truncatedCode: '****21'
    });
    await flushBackground();
    expect(t.emails[0]).toEqual({ type: 'CODIGO_VERIFICACION', email: 'a@x.co', metadata: { codigo: '654321', minutos: 15, logoUrl: 'L' } });
    expect(t.smsGateway.sent[0]).toMatchObject({ phoneNumber: '+56912345678', purpose: 'otp_verification' });
    expect(t.audit.entries.map(e => e.action)).toEqual(['VERIFICATION_CODE_SENT', 'VERIFICATION_CODE_SENT']);
  });

  it('confirmar: un código equivocado suma un intento (y se audita); el correcto lo verifica una sola vez', async () => {
    const t = setup();
    t.codes.codes.push(verificationCode({ contactValue: 'a@x.co' }));

    await expect(t.verify.execute({ type: 'email', contact: 'a@x.co', code: '000000' })).rejects.toThrow('Te quedan 4 intentos');
    expect(t.codes.codes[0]!.attempts).toBe(1);
    expect(t.audit.entries[0]).toMatchObject({ action: 'VERIFICATION_CODE_FAILED', outcome: 'failure', details: { attempts: 1 } });

    await expect(t.verify.execute({ type: 'email', contact: 'a@x.co', code: '654321' })).resolves.toEqual({ verified: true });
    t.codes.findActiveByContact = async () => t.codes.codes[0]!;
    await expect(t.verify.execute({ type: 'email', contact: 'a@x.co', code: '654321' })).rejects.toThrow(CodeAlreadyUsedError);
  });
});

describe('feed de rebotes', () => {
  const envelope = (ses: unknown, over: Record<string, unknown> = {}) => JSON.stringify({ Type: 'Notification', TopicArn: 'arn:t', Message: JSON.stringify(ses), ...over });

  function setup() {
    const verifier = new FakeFeedVerifier();
    const suppressions = new InMemorySuppressions();
    const audit = new RecordingAuditTrail();
    const list = new EmailSuppressionList(suppressions, fakeCipher, audit, silentLogger);
    return { verifier, suppressions, audit, feed: new ProcessBounceFeed(verifier, list, audit, silentLogger, 'arn:t') };
  }

  it('firma y topic obligatorios; la suscripción se confirma', async () => {
    const t = setup();
    t.verifier.valid = false;
    await expect(t.feed.execute(envelope({}))).rejects.toThrow(InvalidFeedSignatureError);
    t.verifier.valid = true;
    await expect(t.feed.execute(envelope({}, { TopicArn: 'arn:otro' }))).rejects.toThrow(UnauthorizedTopicError);
    await expect(t.feed.execute(envelope({}, { Type: 'SubscriptionConfirmation' }))).resolves.toEqual({
      type: 'SubscriptionConfirmation',
      confirmed: true,
      processed: 0,
      suppressed: 0
    });
    expect(t.verifier.confirmed).toBe(1);
  });

  it('cada rebote permanente suma; al tercero la dirección queda suprimida', async () => {
    const t = setup();
    const bounce = envelope({ notificationType: 'Bounce', bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'A@x.co' }] } });
    await t.feed.execute(bounce);
    await t.feed.execute(bounce);
    await expect(t.feed.execute(bounce)).resolves.toEqual({ type: 'Notification', confirmed: false, processed: 1, suppressed: 1 });
    expect(t.suppressions.suppressed.has('h(a@x.co)')).toBe(true);
    expect(t.audit.entries.filter(e => e.action === 'EMAIL_ADDRESS_SUPPRESSED')).toHaveLength(1);

    await expect(t.feed.execute(envelope({ notificationType: 'Complaint' }))).resolves.toEqual({
      type: 'Notification',
      confirmed: false,
      processed: 0,
      suppressed: 0
    });
  });
});

describe('retención', () => {
  it('borra leídas antiguas, dispositivos inactivos y códigos vencidos', async () => {
    const personal = new InMemoryPersonalNotifications([personalNotification({ isRead: true }), personalNotification({ notificationId: 'x' })]);
    const tokens = new InMemoryPushTokens([{ userId: USER_ID, token: 't', isActive: false }]);
    await expect(new PurgeOldNotifications(personal, tokens, silentLogger).execute()).resolves.toEqual({ notificacionesEliminadas: 1, tokensEliminados: 1 });
    await expect(new PurgeVerificationCodes(new InMemoryVerificationCodes(), silentLogger).execute()).resolves.toEqual({
      expiradosEliminados: 2,
      verificadosEliminados: 1
    });
  });

});
