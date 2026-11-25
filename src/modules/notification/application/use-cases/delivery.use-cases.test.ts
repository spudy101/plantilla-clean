// Crear y entregar notificaciones con dobles en memoria: bandeja + entregas por canal, globales con envío
// masivo, reintentos, rebotes definitivos, supresión de correo y SMS.
import { CreateNotification, SendDirectEmail } from './create-notification.use-case';
import { DeliveryAttempts, DispatchDueDeliveries, ScheduleDeliveries } from './deliveries.use-cases';
import { BroadcastGlobalNotification } from './broadcast.use-cases';
import { SendTemplatedEmail } from './send-templated-email.use-case';
import { EmailSuppressionList } from './email-suppression.use-cases';
import { SmsSender } from './sms-sender';
import { UnreadCounter } from './unread-counter';
import { NotificationTypeCodeNotFoundError } from '../../domain/errors';
import { MAX_ATTEMPTS } from '../../domain/delivery';
import {
  FakeEmailGateway,
  FakePushGateway,
  FakeRecipients,
  FakeSmsGateway,
  FakeTransaction,
  FakeUnreadChannel,
  InMemoryDeliveries,
  InMemoryGlobalNotifications,
  InMemoryNotificationTypes,
  InMemoryPersonalNotifications,
  InMemoryPreferences,
  InMemoryPushTokens,
  InMemorySuppressions,
  RecordingRateLimiter,
  USER_ID,
  category,
  fakeCipher,
  fakeClassifier,
  fakePrefixes,
  flushBackground,
  globalNotification,
  notificationType,
  personalNotification,
  preference,
  providerError,
  recipient
} from '../../../../../tests/doubles/notification.doubles';
import { CountingUnitOfWork } from '../../../../../tests/doubles/legal.doubles';
import { RecordingAuditTrail, silentLogger } from '../../../../../tests/doubles/settings.doubles';

function setup() {
  const types = new InMemoryNotificationTypes([notificationType({ category: category({ supportsSms: true }) })]);
  const personal = new InMemoryPersonalNotifications();
  const globals = new InMemoryGlobalNotifications();
  const deliveries = new InMemoryDeliveries();
  const preferences = new InMemoryPreferences();
  const pushTokens = new InMemoryPushTokens([{ userId: USER_ID, token: 'arn:1', isActive: true }]);
  const recipients = new FakeRecipients([recipient()]);
  const suppressions = new InMemorySuppressions();
  const audit = new RecordingAuditTrail();
  const emailGateway = new FakeEmailGateway();
  const push = new FakePushGateway();
  const smsGateway = new FakeSmsGateway();
  const channel = new FakeUnreadChannel();
  const transaction = new FakeTransaction();
  const unitOfWork = new CountingUnitOfWork();
  const rateLimiter = new RecordingRateLimiter();

  const unread = new UnreadCounter(personal, globals, channel, silentLogger);
  const suppressionList = new EmailSuppressionList(suppressions, fakeCipher, audit, silentLogger);
  const email = new SendTemplatedEmail(emailGateway, suppressionList, audit, silentLogger);
  const sms = new SmsSender(smsGateway, fakePrefixes);
  const attempts = new DeliveryAttempts({
    deliveries,
    notifications: personal,
    pushTokens,
    recipients,
    push,
    email,
    sms,
    providerErrors: fakeClassifier,
    cipher: fakeCipher,
    audit,
    logger: silentLogger
  });
  const broadcast = new BroadcastGlobalNotification({
    globals,
    recipients,
    preferences,
    pushTokens,
    push,
    email,
    rateLimiter,
    cipher: fakeCipher,
    logger: silentLogger
  });
  const create = new CreateNotification({
    types,
    personal,
    globals,
    preferences,
    unitOfWork,
    transaction,
    schedule: new ScheduleDeliveries(deliveries, silentLogger),
    attempts,
    broadcast,
    unread,
    logger: silentLogger
  });
  return {
    types,
    personal,
    globals,
    deliveries,
    preferences,
    pushTokens,
    recipients,
    suppressions,
    audit,
    emailGateway,
    push,
    smsGateway,
    channel,
    transaction,
    unitOfWork,
    rateLimiter,
    attempts,
    broadcast,
    create,
    email,
    directEmail: new SendDirectEmail(types, email, fakeCipher, silentLogger)
  };
}

describe('CreateNotification', () => {
  it('a un usuario: bandeja, entregas por canal enviadas tras confirmar y contador refrescado', async () => {
    const t = setup();
    const result = await t.create.execute({
      type: 'OPERATION_APPROVED',
      userId: USER_ID,
      relatedEntity: { type: 'operation', id: 'op-1' },
      metadata: { nombre: 'Ana', id: '42' }
    });

    expect(result).toEqual({ estadoSolicitud: 1, message: 'Notificación creada exitosamente.', notificationId: 'n-1' });
    expect(t.personal.notifications[0]).toMatchObject({
      title: 'Hola Ana',
      body: 'Tu operación 42 fue aprobada',
      relatedEntityType: 'operation',
      relatedEntityId: 'op-1'
    });
    expect(t.unitOfWork.runs).toBe(1);
    expect(t.deliveries.created[0]!.channels).toEqual(['push', 'email', 'sms']);

    await flushBackground();
    expect(t.push.sent.map(p => p.endpoint)).toEqual(['arn:1']);
    expect(t.emailGateway.sent[0]).toMatchObject({ to: 'ana@correo.co', subject: 'Aprobada 42', notificationId: 'n-1' });
    expect(t.smsGateway.sent[0]).toMatchObject({ phoneNumber: '+56912345678', message: 'Tu operación 42 fue aprobada', purpose: 'notification' });
    expect(t.deliveries.outcomes.map(o => o.result)).toEqual(['sent', 'sent', 'sent']);
    expect(t.channel.published).toContainEqual({ userId: USER_ID, count: 1 });
  });

  it('respeta la preferencia del usuario (canales permitidos)', async () => {
    const t = setup();
    t.preferences.preferences.push(preference({ allowEmail: false, allowSms: false }));
    await t.create.execute({ type: 'OPERATION_APPROVED', userId: USER_ID });
    expect(t.deliveries.created[0]!.channels).toEqual(['push']);
  });

  it('dentro de una unidad de trabajo no envía: lo toma el despachador', async () => {
    const t = setup();
    t.transaction.active = true;
    await t.create.execute({ type: 'OPERATION_APPROVED', userId: USER_ID });
    await flushBackground();
    expect(t.deliveries.created).toHaveLength(1);
    expect(t.push.sent).toEqual([]);
  });

  it('sin usuario: una global reservada, el envío masivo y la invalidación del contador de todos', async () => {
    const t = setup();
    t.recipients.clients = [{ userId: USER_ID, email: 'enc:ana@correo.co' }];
    const result = await t.create.execute({ type: 'OPERATION_APPROVED', metadata: { nombre: 'Ana' } });

    expect(result).toMatchObject({ globalNotificationId: 'g-1' });
    expect(t.globals.created[0]).toMatchObject({ title: 'Hola Ana', sendPush: true, sendEmail: true, reservedUntil: expect.any(Date) });
    await flushBackground();
    expect(t.channel.published).toContainEqual({ global: true });
    expect(t.push.bulk[0]!.endpoints).toEqual(['arn:1']);
    expect(t.emailGateway.sent[0]!.to).toBe('ana@correo.co');
    expect(t.globals.finished).toEqual([{ id: 'g-1', status: 'completed' }]);
  });

  it('tipo desconocido o inactivo: no encontrado', async () => {
    const t = setup();
    await expect(t.create.execute({ type: 'NOPE', userId: USER_ID })).rejects.toThrow(NotificationTypeCodeNotFoundError);
    await expect(t.create.execute({ type: '', userId: USER_ID })).rejects.toThrow('tipoNotificacion es requerido');
  });
});

describe('SendDirectEmail', () => {
  it('envía a la dirección (descifrada) sin pasar por la bandeja', async () => {
    const t = setup();
    await expect(t.directEmail.execute({ type: 'OPERATION_APPROVED', email: 'enc:ex@correo.co', metadata: { id: '7' } })).resolves.toEqual({
      estadoSolicitud: 1,
      message: 'Notificación enviada exitosamente por email.'
    });
    expect(t.emailGateway.sent[0]).toMatchObject({ to: 'ex@correo.co', subject: 'Aprobada 7' });
    expect(t.personal.notifications).toEqual([]);
    await expect(t.directEmail.execute({ type: 'OPERATION_APPROVED', email: '' })).rejects.toThrow('email es requerido');
  });
});

describe('DeliveryAttempts', () => {
  const delivery = (channel: 'push' | 'email' | 'sms', attempts = 0) => ({ notificationDeliveryId: 'd-1', notificationId: 'n-1', channel, attempts });

  it('push: basta con un dispositivo; los dados de baja se desactivan', async () => {
    const t = setup();
    t.pushTokens.devices.push({ userId: USER_ID, token: 'arn:2', isActive: true });
    t.push.failures.set('arn:2', providerError('EndpointDisabled'));

    await expect(t.attempts.attempt(delivery('push'), personalNotification())).resolves.toEqual({ status: 'sent' });
    expect(t.pushTokens.devices.find(d => d.token === 'arn:2')!.isActive).toBe(false);
  });

  it('push: si todos rebotan de forma definitiva, fallida para siempre y auditada', async () => {
    const t = setup();
    t.push.failures.set('arn:1', providerError('EndpointDisabled'));
    const outcome = await t.attempts.attempt(delivery('push'), personalNotification());

    expect(outcome).toMatchObject({ status: 'error', permanent: true, errorCode: 'EndpointDisabled' });
    expect(t.deliveries.outcomes[0]).toMatchObject({ result: 'failure', detail: { nextAttemptAt: null } });
    expect(t.audit.entries[0]).toMatchObject({ action: 'PUSH_DELIVERY_FAILED', details: { reason: 'hard_bounce', attempts: 1 }, outcome: 'failure' });
  });

  it('error temporal: se reintenta; en el último intento, fallida por intentos agotados', async () => {
    const t = setup();
    t.emailGateway.failWith = providerError('Throttling');

    await t.attempts.attempt(delivery('email'), personalNotification());
    expect(t.deliveries.outcomes[0]).toMatchObject({ result: 'failure', detail: { errorCode: 'Throttling', nextAttemptAt: expect.any(Date) } });
    expect(t.audit.entries).toEqual([]);

    await t.attempts.attempt(delivery('email', MAX_ATTEMPTS - 1), personalNotification());
    expect(t.audit.entries[0]).toMatchObject({ action: 'EMAIL_DELIVERY_FAILED', details: { reason: 'attempts_exhausted' } });
  });

  it('email: al de la metadata si viene; dirección suprimida → sin destinatario (y se audita)', async () => {
    const t = setup();
    await t.attempts.attempt(delivery('email'), personalNotification({ metadata: { email: 'enc:otro@correo.co' } }));
    expect(t.emailGateway.sent[0]!.to).toBe('otro@correo.co');

    t.suppressions.suppressed.add('h(ana@correo.co)');
    const outcome = await t.attempts.attempt(delivery('email'), personalNotification());
    expect(outcome).toEqual({ status: 'skipped', reason: 'Dirección suprimida o tipo sin plantilla de email' });
    expect(t.audit.entries.map(e => e.action)).toContain('EMAIL_SUPPRESSED_SEND_SKIPPED');
  });

  it('sin dispositivos, sin email o sin teléfono: se cierra como sin destinatario', async () => {
    const t = setup();
    t.pushTokens.devices = [];
    t.recipients.recipients = [recipient({ email: null, phone: null })];
    for (const channel of ['push', 'email', 'sms'] as const) {
      await t.attempts.attempt(delivery(channel), personalNotification());
    }
    expect(t.deliveries.outcomes.map(o => o.detail)).toEqual(['Usuario sin dispositivos push activos', 'Usuario sin email', 'Usuario sin teléfono']);
  });

  it('sms: un fallo del proveedor es temporal', async () => {
    const t = setup();
    t.smsGateway.result = { success: false, error: 'caído' };
    await expect(t.attempts.attempt(delivery('sms'), personalNotification({ body: 'x'.repeat(200) }))).resolves.toEqual({
      status: 'error',
      error: 'caído',
      errorCode: null,
      permanent: false
    });
    expect(t.smsGateway.sent[0]!.message).toHaveLength(160);
  });
});

describe('DispatchDueDeliveries', () => {
  it('toma de a tandas hasta vaciar lo vencido y lo envuelve solo si hubo algo', async () => {
    const t = setup();
    t.personal.notifications.push(personalNotification({ notificationId: 'n-1' }));
    const full = Array.from({ length: 50 }, (_, i) => ({ notificationDeliveryId: `d-${i}`, notificationId: 'n-1', channel: 'push' as const, attempts: 0 }));
    t.deliveries.batches = [full, [{ notificationDeliveryId: 'd-x', notificationId: 'n-1', channel: 'push', attempts: 0 }]];
    let wrapped = 0;
    const dispatcher = new DispatchDueDeliveries(t.deliveries, t.attempts);

    await expect(dispatcher.execute(send => (wrapped++, send()))).resolves.toEqual({ attempted: 51 });
    expect(wrapped).toBe(1);
    expect(t.deliveries.outcomes).toHaveLength(51);

    await expect(dispatcher.execute(send => (wrapped++, send()))).resolves.toEqual({ attempted: 0 });
    expect(wrapped).toBe(1);
  });
});

describe('BroadcastGlobalNotification', () => {
  it('por páginas, con el avance guardado, filtrando por preferencia (salvo crítica)', async () => {
    const t = setup();
    t.recipients.clients = [
      { userId: 'u-1', email: 'a@x.co' },
      { userId: 'u-2', email: 'b@x.co' }
    ];
    t.pushTokens.devices = [
      { userId: 'u-1', token: 'arn:a', isActive: true },
      { userId: 'u-2', token: 'arn:b', isActive: true }
    ];
    t.preferences.preferences.push(preference({ userId: 'u-2', allowPush: false, allowEmail: false }));

    await t.broadcast.send(globalNotification({ globalNotificationId: 'g-9' }));
    expect(t.push.bulk[0]!.endpoints).toEqual(['arn:a']);
    expect(t.emailGateway.sent.map(e => e.to)).toEqual(['a@x.co']);
    expect(t.globals.progress).toEqual([{ id: 'g-9', cursorUserId: 'u-2', pushSent: 1, emailSent: 1, leaseMs: expect.any(Number) }]);
    expect(t.rateLimiter.taken).toEqual([
      { provider: 'push', amount: 1 },
      { provider: 'email', amount: 1 }
    ]);

    await t.broadcast.send(globalNotification({ globalNotificationId: 'g-10', notificationType: notificationType({ category: category({ isCritical: true }) }) }));
    expect(t.push.bulk[1]!.endpoints).toEqual(['arn:a', 'arn:b']);
  });

  it('retoma desde el cursor; sin tipo, termina fallida', async () => {
    const t = setup();
    t.recipients.clients = [
      { userId: 'u-1', email: null },
      { userId: 'u-2', email: null }
    ];
    await t.broadcast.send(globalNotification({ globalNotificationId: 'g-1', cursorUserId: 'u-1', sendPush: false }));
    expect(t.recipients.pages[0]).toEqual({ after: 'u-1', limit: 100 });

    await t.broadcast.send(globalNotification({ globalNotificationId: 'g-2', notificationType: null }));
    expect(t.globals.finished).toContainEqual({ id: 'g-2', status: 'failed' });
  });

  it('el despachador retoma lo pendiente y no se solapa consigo mismo', async () => {
    const t = setup();
    t.globals.claimable = [globalNotification({ globalNotificationId: 'g-5', sendPush: false, sendEmail: false })];
    await expect(t.broadcast.dispatchDue()).resolves.toEqual({ resumed: 1 });
    expect(t.globals.finished).toEqual([{ id: 'g-5', status: 'completed' }]);
  });
});

describe('SendTemplatedEmail', () => {
  it('sin canal de email o sin plantillas no envía; un fallo del proveedor se propaga', async () => {
    const t = setup();
    await expect(t.email.execute('a@x.co', notificationType({ category: category({ supportsEmail: false }) }), {})).resolves.toBeNull();
    await expect(t.email.execute('a@x.co', notificationType({ emailBodyTemplate: null }), {})).resolves.toBeNull();
    t.emailGateway.failWith = new Error('SES caído');
    await expect(t.email.execute('a@x.co', notificationType(), {})).rejects.toThrow('SES caído');
  });

  it('el layout de la categoría y los adjuntos del envío', async () => {
    const t = setup();
    const attachments = [{ filename: 'a.pdf', content: 'QUJD' }];
    await t.email.execute('a@x.co', notificationType(), { nombre: 'Ana', logoUrl: 'L', attachments });
    expect(t.emailGateway.sent[0]).toEqual({
      to: 'a@x.co',
      subject: 'Aprobada {{id}}',
      html: '<div><p>Hola Ana</p><img src="L"></div>',
      attachments,
      notificationId: null
    });
  });
});
