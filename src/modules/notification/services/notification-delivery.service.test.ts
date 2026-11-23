// NotificationDeliveryService — envío por canal externo con reintentos. Probamos: qué canales salen
// (categoría + preferencia, y la crítica que ignora la preferencia), cuándo (ya, reservadas; diferidas
// por horario de silencio; o para el despachador si quien llama está en una transacción), el resultado
// de cada intento (enviado / sin destinatario / error temporal con espera creciente / rebote definitivo
// o último intento → fallida + auditoría) y el ciclo del despachador. Repos y servicios de canal se mockean.

jest.mock('../repositories/notification.repository', () => ({ findByIdWithType: jest.fn() }));
jest.mock('../repositories/notification-delivery.repository', () => ({
  createForNotification: jest.fn(),
  claimDue: jest.fn(),
  markSent: jest.fn(),
  markSkipped: jest.fn(),
  recordFailure: jest.fn()
}));
jest.mock('../../iam/repositories/user.repository', () => ({ findByUserId: jest.fn() }));
jest.mock('../repositories/user-push-token.repository', () => ({ findActiveByUser: jest.fn(), deactivateTokens: jest.fn() }));
jest.mock('./email-notification.service', () => ({ enviarNotificacion: jest.fn() }));
jest.mock('./push-notification.service', () => ({ enviarPushIndividual: jest.fn() }));
jest.mock('./sms.service', () => ({ resolveE164: jest.fn().mockResolvedValue('+56911112222'), enviarSms: jest.fn() }));
jest.mock('../../../shared/infrastructure/security/encryption.util', () => ({ safeDecrypt: jest.fn((v: string) => v) }));
jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
  logAudit: jest.fn()
}));
jest.mock('../../audit/infrastructure/legacy/audit-recorder', () => ({ record: jest.fn() }));

import { mocked, Loose } from 'tests/helpers/mock';
import notificationRepoModule from '../repositories/notification.repository';
const notificationRepo = mocked(notificationRepoModule);
import deliveryRepoModule from '../repositories/notification-delivery.repository';
const deliveryRepo = mocked(deliveryRepoModule);
import userRepoModule from '../../iam/repositories/user.repository';
const userRepo = mocked(userRepoModule);
import userPushTokenRepoModule from '../repositories/user-push-token.repository';
const userPushTokenRepo = mocked(userPushTokenRepoModule);
import emailServiceModule from './email-notification.service';
const emailService = mocked(emailServiceModule);
import pushServiceModule from './push-notification.service';
const pushService = mocked(pushServiceModule);
import smsServiceModule from './sms.service';
const smsService = mocked(smsServiceModule);
import auditServiceModule from '../../audit/infrastructure/legacy/audit-recorder';
const audit = mocked(auditServiceModule);
import delivery, { LEASE_MS, MAX_ATTEMPTS } from './notification-delivery.service';

const MINUTE = 60 * 1000;
const flush = () =>
  new Promise(resolve => {
    setImmediate(resolve);
  });

const type = (category: Loose = {}): Loose => ({
  code: 'T',
  emailSubjectTemplate: 's',
  emailBodyTemplate: 'b',
  category: { supportsPush: true, supportsEmail: true, supportsSms: false, isCritical: false, ...category }
});
const notification = (overrides: Loose = {}): Loose => ({
  notificationId: 'n-1',
  userId: 'u-1',
  title: 'Hola',
  body: 'Cuerpo',
  metadata: {},
  notificationType: type(),
  ...overrides
});
const claimed = (overrides: Loose = {}): Loose => ({
  notificationDeliveryId: 'd-1',
  notificationId: 'n-1',
  channel: 'email',
  attempts: 0,
  ...overrides
});
const awsError = (name: string) => Object.assign(new Error(name), { name, $metadata: {} });

beforeEach(() => {
  jest.clearAllMocks();
  deliveryRepo.createForNotification.mockImplementation(async (_id: string, channels: string[]) =>
    channels.map(channel => ({ notificationDeliveryId: `d-${channel}`, channel }))
  );
});

describe('channelsFor', () => {
  it('sale por los canales que soporta la categoría y permite el usuario', () => {
    expect(delivery.channelsFor(type(), null)).toEqual(['push', 'email']);
    expect(delivery.channelsFor(type(), { allowEmail: false })).toEqual(['push']);
    expect(delivery.channelsFor(type({ supportsSms: true }), { allowPush: false })).toEqual(['email', 'sms']);
  });

  it('una categoría crítica ignora la preferencia del usuario (pero no los canales que soporta)', () => {
    const critical = type({ isCritical: true, supportsSms: true });
    expect(delivery.channelsFor(critical, { allowPush: false, allowEmail: false, allowSms: false })).toEqual([
      'push',
      'email',
      'sms'
    ]);
    expect(delivery.channelsFor(type({ isCritical: true, supportsPush: false }), { allowEmail: false })).toEqual(['email']);
  });

  it('sin categoría: push y email sí, sms no', () => {
    expect(
      delivery.channelsFor({ code: 'T', emailSubjectTemplate: null, emailBodyTemplate: null, category: null }, null)
    ).toEqual(['push', 'email']);
  });
});

describe('schedule', () => {
  afterEach(() => jest.useRealTimers());

  it('fuera del horario de silencio deja las entregas reservadas para enviarlas ya', async () => {
    const before = Date.now();
    const result = await delivery.schedule('n-1', type(), null, { canSendNow: true });

    expect(result.sendNow).toBe(true);
    const [, channels, firstAttemptAt] = deliveryRepo.createForNotification.mock.calls[0]!;
    expect(channels).toEqual(['push', 'email']);
    expect((firstAttemptAt as Date).getTime()).toBeGreaterThanOrEqual(before + LEASE_MS);
  });

  it('en horario de silencio las difiere al final del horario', async () => {
    jest.useFakeTimers({ now: new Date(2026, 0, 1, 23, 0, 0), doNotFake: ['setImmediate'] });
    const result = await delivery.schedule(
      'n-1',
      type(),
      { quietHoursStart: '22:00:00', quietHoursEnd: '07:00:00' },
      { canSendNow: true }
    );

    expect(result.sendNow).toBe(false);
    expect(deliveryRepo.createForNotification.mock.calls[0]![2]).toEqual(new Date(2026, 0, 2, 7, 0, 0));
  });

  it('una categoría crítica no espera el horario de silencio', async () => {
    jest.useFakeTimers({ now: new Date(2026, 0, 1, 23, 0, 0), doNotFake: ['setImmediate'] });
    const result = await delivery.schedule(
      'n-1',
      type({ isCritical: true }),
      { quietHoursStart: '22:00', quietHoursEnd: '07:00' },
      { canSendNow: true }
    );

    expect(result.sendNow).toBe(true);
  });

  it('si no se puede enviar ya (transacción de quien llama), quedan vencidas para el despachador', async () => {
    const before = Date.now();
    const result = await delivery.schedule('n-1', type(), null, { canSendNow: false });

    expect(result.sendNow).toBe(false);
    expect((deliveryRepo.createForNotification.mock.calls[0]![2] as Date).getTime()).toBeLessThan(before + MINUTE);
  });

  it('sin canales no hay nada que enviar', async () => {
    const result = await delivery.schedule('n-1', type(), { allowPush: false, allowEmail: false }, { canSendNow: true });
    expect(result).toEqual({ deliveries: [], sendNow: false });
  });
});

describe('attempt', () => {
  it('enviado → sent', async () => {
    emailService.enviarNotificacion.mockResolvedValue({ MessageId: 'm-1' });
    userRepo.findByUserId.mockResolvedValue({ person: { contact: { email: 'ana@x.cl' } } });

    await delivery.attempt(claimed(), notification());

    expect(emailService.enviarNotificacion).toHaveBeenCalledWith('ana@x.cl', expect.objectContaining({ code: 'T' }), {}, 'n-1');
    expect(deliveryRepo.markSent).toHaveBeenCalledWith('d-1');
  });

  it('sin destinatario → skipped (no se reintenta)', async () => {
    userRepo.findByUserId.mockResolvedValue({ person: { contact: {} } });

    await delivery.attempt(claimed(), notification());

    expect(deliveryRepo.markSkipped).toHaveBeenCalledWith('d-1', 'Usuario sin email');
    expect(deliveryRepo.recordFailure).not.toHaveBeenCalled();
  });

  it('dirección suprimida (el servicio de email no envía) → skipped', async () => {
    emailService.enviarNotificacion.mockResolvedValue(null);

    await delivery.attempt(claimed(), notification({ metadata: { email: 'ana@x.cl' } }));

    expect(deliveryRepo.markSkipped).toHaveBeenCalledWith('d-1', expect.stringMatching(/suprimida/));
  });

  it('error temporal → sigue pendiente, con espera creciente según el intento', async () => {
    emailService.enviarNotificacion.mockRejectedValue(awsError('Throttling'));
    const now = Date.now();

    await delivery.attempt(claimed({ attempts: 0 }), notification({ metadata: { email: 'a@x.cl' } }));
    await delivery.attempt(claimed({ attempts: 1 }), notification({ metadata: { email: 'a@x.cl' } }));

    const [first, second] = deliveryRepo.recordFailure.mock.calls.map(c => c[1] as Loose);
    expect(first).toMatchObject({ error: 'Throttling', errorCode: 'Throttling' });
    expect(first.nextAttemptAt.getTime() - now).toBeGreaterThanOrEqual(MINUTE);
    expect(second.nextAttemptAt.getTime() - now).toBeGreaterThanOrEqual(5 * MINUTE);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('último intento fallido → failed y se audita una vez', async () => {
    emailService.enviarNotificacion.mockRejectedValue(awsError('Throttling'));

    await delivery.attempt(claimed({ attempts: MAX_ATTEMPTS - 1 }), notification({ metadata: { email: 'a@x.cl' } }));

    expect(deliveryRepo.recordFailure).toHaveBeenCalledWith('d-1', expect.objectContaining({ nextAttemptAt: null }));
    expect(audit.record).toHaveBeenCalledWith(
      'EMAIL_DELIVERY_FAILED',
      expect.objectContaining({ details: expect.objectContaining({ reason: 'attempts_exhausted', attempts: MAX_ATTEMPTS }) })
    );
  });

  it('rebote definitivo → failed en el primer intento', async () => {
    emailService.enviarNotificacion.mockRejectedValue(awsError('MessageRejected'));

    await delivery.attempt(claimed(), notification({ metadata: { email: 'a@x.cl' } }));

    expect(deliveryRepo.recordFailure).toHaveBeenCalledWith('d-1', {
      error: 'MessageRejected',
      errorCode: 'MessageRejected',
      nextAttemptAt: null
    });
    expect(audit.record).toHaveBeenCalledWith(
      'EMAIL_DELIVERY_FAILED',
      expect.objectContaining({ details: expect.objectContaining({ reason: 'hard_bounce' }) })
    );
  });
});

describe('sendPush', () => {
  it('sin dispositivos activos → skipped', async () => {
    userPushTokenRepo.findActiveByUser.mockResolvedValue([]);
    await expect(delivery.sendPush(notification())).resolves.toEqual({ status: 'skipped', reason: expect.any(String) });
  });

  it('basta con que llegue a un dispositivo', async () => {
    userPushTokenRepo.findActiveByUser.mockResolvedValue([{ token: 'a' }, { token: 'b' }]);
    pushService.enviarPushIndividual.mockRejectedValueOnce(awsError('EndpointDisabled')).mockResolvedValueOnce({});
    await expect(delivery.sendPush(notification())).resolves.toEqual({ status: 'sent' });
  });

  it('rebote definitivo solo si todos los dispositivos fallaron con un código definitivo', async () => {
    userPushTokenRepo.findActiveByUser.mockResolvedValue([{ token: 'a' }, { token: 'b' }]);
    pushService.enviarPushIndividual.mockRejectedValue(awsError('EndpointDisabled'));
    await expect(delivery.sendPush(notification())).resolves.toMatchObject({
      status: 'error',
      permanent: true,
      errorCode: 'EndpointDisabled'
    });

    pushService.enviarPushIndividual
      .mockRejectedValueOnce(awsError('EndpointDisabled'))
      .mockRejectedValueOnce(awsError('Throttling'));
    await expect(delivery.sendPush(notification())).resolves.toMatchObject({ status: 'error', permanent: false });
  });

  it('desactiva el token de los dispositivos dados de baja (EndpointDisabled), aunque llegue a otro', async () => {
    userPushTokenRepo.findActiveByUser.mockResolvedValue([{ token: 'a' }, { token: 'b' }, { token: 'c' }]);
    pushService.enviarPushIndividual
      .mockRejectedValueOnce(awsError('EndpointDisabled'))
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(awsError('InvalidParameter'));

    await expect(delivery.sendPush(notification())).resolves.toEqual({ status: 'sent' });
    // InvalidParameter puede ser el mensaje y no el dispositivo: ese token se conserva
    expect(userPushTokenRepo.deactivateTokens).toHaveBeenCalledWith(['a']);
  });

  it('si desactivar el token falla, el resultado de la entrega no cambia', async () => {
    userPushTokenRepo.findActiveByUser.mockResolvedValue([{ token: 'a' }]);
    pushService.enviarPushIndividual.mockRejectedValue(awsError('EndpointDisabled'));
    userPushTokenRepo.deactivateTokens.mockRejectedValueOnce(new Error('db down'));

    await expect(delivery.sendPush(notification())).resolves.toMatchObject({ status: 'error', permanent: true });
  });
});

describe('sendSms', () => {
  it('fallo de SNS → error temporal (SMS no tiene rebote definitivo)', async () => {
    smsService.enviarSms.mockResolvedValue({ success: false, error: 'sin saldo' });
    await expect(delivery.sendSms(notification({ metadata: { phone: '911112222' } }))).resolves.toEqual({
      status: 'error',
      error: 'sin saldo',
      errorCode: null,
      permanent: false
    });
  });
});

describe('sendInBackground', () => {
  it('intenta las entregas reservadas sin bloquear a quien llama', async () => {
    emailService.enviarNotificacion.mockResolvedValue({});
    delivery.sendInBackground([claimed()], notification({ metadata: { email: 'a@x.cl' } }));
    expect(deliveryRepo.markSent).not.toHaveBeenCalled();

    await flush();
    await flush();
    expect(deliveryRepo.markSent).toHaveBeenCalledWith('d-1');
  });
});

describe('dispatchDue', () => {
  it('sin entregas vencidas no abre la operación', async () => {
    deliveryRepo.claimDue.mockResolvedValue([]);
    const wrap = jest.fn();

    await expect(delivery.dispatchDue(wrap)).resolves.toEqual({ attempted: 0 });
    expect(wrap).not.toHaveBeenCalled();
  });

  it('lee cada notificación una vez e intenta sus entregas; si ya no existe, las salta', async () => {
    deliveryRepo.claimDue.mockResolvedValue([
      claimed({ notificationDeliveryId: 'd-1', channel: 'email' }),
      claimed({ notificationDeliveryId: 'd-2', channel: 'push' }),
      claimed({ notificationDeliveryId: 'd-3', notificationId: 'gone' })
    ]);
    notificationRepo.findByIdWithType.mockImplementation(async (id: string) =>
      id === 'n-1' ? notification({ metadata: { email: 'a@x.cl' } }) : null
    );
    emailService.enviarNotificacion.mockResolvedValue({});
    userPushTokenRepo.findActiveByUser.mockResolvedValue([]);

    await expect(delivery.dispatchDue()).resolves.toEqual({ attempted: 3 });

    expect(notificationRepo.findByIdWithType).toHaveBeenCalledTimes(2);
    expect(deliveryRepo.markSent).toHaveBeenCalledWith('d-1');
    expect(deliveryRepo.markSkipped).toHaveBeenCalledWith('d-2', expect.any(String));
    expect(deliveryRepo.markSent).not.toHaveBeenCalledWith('d-3');
  });

  it('vacía lo vencido en varias tomas dentro del mismo ciclo, con una sola operación', async () => {
    const fullBatch = Array.from({ length: 50 }, (_, i) => claimed({ notificationDeliveryId: `a-${i}`, notificationId: `n-a-${i}` }));
    deliveryRepo.claimDue
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce([claimed({ notificationDeliveryId: 'b-1', notificationId: 'n-b-1' })]);
    notificationRepo.findByIdWithType.mockResolvedValue(null);
    let operations = 0;
    const wrap = <T,>(send: () => Promise<T>) => {
      operations++;
      return send();
    };

    await expect(delivery.dispatchDue(wrap)).resolves.toEqual({ attempted: 51 });

    expect(deliveryRepo.claimDue).toHaveBeenCalledTimes(2);
    expect(operations).toBe(1);
    expect(notificationRepo.findByIdWithType).toHaveBeenCalledTimes(51);
  });

  it('deja de tomar al agotar el tiempo del ciclo (sigue el próximo)', async () => {
    const fullBatch = Array.from({ length: 50 }, (_, i) => claimed({ notificationDeliveryId: `a-${i}`, notificationId: `n-a-${i}` }));
    deliveryRepo.claimDue.mockResolvedValue(fullBatch);
    notificationRepo.findByIdWithType.mockResolvedValue(null);
    const now = jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(60 * 1000);

    try {
      await expect(delivery.dispatchDue()).resolves.toEqual({ attempted: 50 });
      expect(deliveryRepo.claimDue).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it('un fallo al leer una notificación no frena las demás', async () => {
    deliveryRepo.claimDue.mockResolvedValue([
      claimed({ notificationDeliveryId: 'd-1', notificationId: 'broken' }),
      claimed({ notificationDeliveryId: 'd-2', channel: 'email' })
    ]);
    notificationRepo.findByIdWithType.mockImplementation(async (id: string) => {
      if (id === 'broken') {
        throw new Error('db down');
      }
      return notification({ metadata: { email: 'a@x.cl' } });
    });
    emailService.enviarNotificacion.mockResolvedValue({});

    await expect(delivery.dispatchDue()).resolves.toEqual({ attempted: 2 });
    expect(deliveryRepo.markSent).toHaveBeenCalledWith('d-2');
  });
});
