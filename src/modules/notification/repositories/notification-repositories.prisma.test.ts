// tests/unit/modules/schemas/notification/repositories/notification-repositories.prisma.test.ts
//
// Repositorios del grupo 3 (notificaciones) sobre Prisma (docs/prisma-migration.md, fase 5): se mockea
// el cliente único y se verifica que arman las consultas con los campos de Prisma. Incluye las
// regresiones que antes cubrían los tests de Sequelize (upsertToken sin await, markAsReadByIds solo
// sobre las no leídas, ventana de countFailedBetween) y la conversión de las columnas TIME.

const mockDb = {
  $transaction: jest.fn(),
  userPushToken: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  $queryRaw: jest.fn(),
  notification: { updateMany: jest.fn() },
  notificationDelivery: { createManyAndReturn: jest.fn(), updateManyAndReturn: jest.fn() },
  smsDeliveryAttempt: { count: jest.fn() },
  verificationCode: { updateMany: jest.fn() },
  userNotificationPreference: { findUnique: jest.fn(), upsert: jest.fn() },
  emailBounceSuppression: { upsert: jest.fn(), update: jest.fn() }
};

jest.mock('../../../shared/infrastructure/database/prisma', () => mockDb);

import userPushTokenRepository from './user-push-token.repository';
import notificationRepository from './notification.repository';
import notificationDeliveryRepository from './notification-delivery.repository';
import smsDeliveryAttemptRepository from './sms-delivery-attempt.repository';
import verificationCodeRepository from './verification-code.repository';
import userNotificationPreferenceRepository from './user-notification-preference.repository';
import emailBounceSuppressionRepository from './email-bounce-suppression.repository';
import { fromTime, toTime } from '../../../shared/infrastructure/database/prisma-time';

beforeEach(() => {
  jest.clearAllMocks();
  // Fuera de una unidad de trabajo, `atomic()` abre su propia transacción con el mismo cliente
  mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
});

describe('UserPushTokenRepository.upsertToken', () => {
  it('reasigna y reactiva el token existente del dispositivo', async () => {
    mockDb.userPushToken.findFirst.mockResolvedValueOnce({ userPushTokenId: 't-1' });
    mockDb.userPushToken.update.mockResolvedValue('updated');

    await expect(userPushTokenRepository.upsertToken('u-1', 'arn:token', 'android', 'dev-1')).resolves.toBe('updated');

    expect(mockDb.userPushToken.findFirst).toHaveBeenCalledWith({ where: { deviceId: 'dev-1' } });
    expect(mockDb.userPushToken.update).toHaveBeenCalledWith({
      where: { userPushTokenId: 't-1' },
      data: expect.objectContaining({ userId: 'u-1', token: 'arn:token', deviceId: 'dev-1', isActive: true })
    });
    expect(mockDb.userPushToken.create).not.toHaveBeenCalled();
  });

  it('cae a la búsqueda por token y, si no hay registro, crea uno nuevo', async () => {
    mockDb.userPushToken.findFirst.mockResolvedValue(null);
    mockDb.userPushToken.create.mockResolvedValue('created');

    await expect(userPushTokenRepository.upsertToken('u-1', 'arn:token', 'ios', 'dev-1')).resolves.toBe('created');

    expect(mockDb.userPushToken.findFirst).toHaveBeenCalledTimes(2);
    expect(mockDb.userPushToken.findFirst).toHaveBeenLastCalledWith({ where: { token: 'arn:token' } });
    expect(mockDb.userPushToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u-1', token: 'arn:token', platform: 'ios', isActive: true })
    });
  });
});

describe('NotificationRepository', () => {
  it('markAsReadByIds marca como leídas solo las no leídas de los IDs indicados', async () => {
    mockDb.notification.updateMany.mockResolvedValue({ count: 1 });

    await expect(notificationRepository.markAsReadByIds(['n-1', 'n-2'])).resolves.toBe(1);

    expect(mockDb.notification.updateMany).toHaveBeenCalledWith({
      where: { notificationId: { in: ['n-1', 'n-2'] }, isRead: false },
      data: { isRead: true, readAt: expect.any(Date) }
    });
  });
});

describe('NotificationDeliveryRepository', () => {
  it('createForNotification crea una entrega pendiente por canal con el mismo primer intento', async () => {
    const at = new Date('2026-01-01T10:00:00Z');
    mockDb.notificationDelivery.createManyAndReturn.mockResolvedValue([{ notificationDeliveryId: 'd-1' }]);

    await notificationDeliveryRepository.createForNotification('n-1', ['push', 'email'], at);

    expect(mockDb.notificationDelivery.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        { notificationId: 'n-1', channel: 'push', nextAttemptAt: at },
        { notificationId: 'n-1', channel: 'email', nextAttemptAt: at }
      ]
    });
  });

  it('createForNotification sin canales no toca la base', async () => {
    await expect(notificationDeliveryRepository.createForNotification('n-1', [], new Date())).resolves.toEqual([]);
    expect(mockDb.notificationDelivery.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('claimDue toma con SKIP LOCKED y devuelve las filas en camelCase', async () => {
    mockDb.$queryRaw.mockResolvedValue([
      { notification_delivery_id: 'd-1', notification_id: 'n-1', channel: 'email', attempts: 2 }
    ]);

    await expect(notificationDeliveryRepository.claimDue(50, 300000)).resolves.toEqual([
      { notificationDeliveryId: 'd-1', notificationId: 'n-1', channel: 'email', attempts: 2 }
    ]);
    const sql = (mockDb.$queryRaw.mock.calls[0]![0] as string[]).join('?');
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    // Las fechas van como parámetros (ver claimDue), no como now()
    expect(sql).toMatch(/status = 'pending' AND next_attempt_at <= \?/);
  });

  it('recordFailure con próximo intento queda pendiente; sin él, fallida', async () => {
    mockDb.notificationDelivery.updateManyAndReturn.mockResolvedValue([{}]);
    const next = new Date();

    await notificationDeliveryRepository.recordFailure('d-1', { error: 'boom', errorCode: 'Throttling', nextAttemptAt: next });
    expect(mockDb.notificationDelivery.updateManyAndReturn).toHaveBeenLastCalledWith({
      where: { notificationDeliveryId: 'd-1' },
      data: { status: 'pending', attempts: { increment: 1 }, nextAttemptAt: next, lastError: 'boom', lastErrorCode: 'Throttling' }
    });

    await notificationDeliveryRepository.recordFailure('d-1', {
      error: 'rebote',
      errorCode: 'MessageRejected',
      nextAttemptAt: null
    });
    expect(mockDb.notificationDelivery.updateManyAndReturn).toHaveBeenLastCalledWith({
      where: { notificationDeliveryId: 'd-1' },
      data: expect.objectContaining({ status: 'failed', nextAttemptAt: null })
    });
  });

  it('markSent y markSkipped cierran la entrega (sin próximo intento)', async () => {
    mockDb.notificationDelivery.updateManyAndReturn.mockResolvedValue([]);

    await expect(notificationDeliveryRepository.markSent('d-1')).resolves.toBeNull();
    expect(mockDb.notificationDelivery.updateManyAndReturn).toHaveBeenLastCalledWith({
      where: { notificationDeliveryId: 'd-1' },
      data: expect.objectContaining({ status: 'sent', sentAt: expect.any(Date), nextAttemptAt: null, attempts: { increment: 1 } })
    });

    await notificationDeliveryRepository.markSkipped('d-2', 'Usuario sin email');
    expect(mockDb.notificationDelivery.updateManyAndReturn).toHaveBeenLastCalledWith({
      where: { notificationDeliveryId: 'd-2' },
      data: { status: 'skipped', lastError: 'Usuario sin email', nextAttemptAt: null }
    });
  });
});

describe('SmsDeliveryAttemptRepository.countFailedBetween', () => {
  it('con inicio cuenta en la ventana; sin inicio, todo hasta el fin', async () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-01-01T01:00:00Z');
    mockDb.smsDeliveryAttempt.count.mockResolvedValue(2);

    await expect(smsDeliveryAttemptRepository.countFailedBetween(from, to)).resolves.toBe(2);
    expect(mockDb.smsDeliveryAttempt.count).toHaveBeenLastCalledWith({
      where: { status: 'failed', createdAt: { gte: from, lte: to } }
    });

    await smsDeliveryAttemptRepository.countFailedBetween(null, to);
    expect(mockDb.smsDeliveryAttempt.count).toHaveBeenLastCalledWith({ where: { status: 'failed', createdAt: { lte: to } } });
  });
});

describe('VerificationCodeRepository.incrementAttempts', () => {
  it('solo suma sobre un código vigente y sin verificar, en la base', async () => {
    mockDb.verificationCode.updateMany.mockResolvedValue({ count: 1 });

    await expect(verificationCodeRepository.incrementAttempts('vc-1')).resolves.toBe(1);

    expect(mockDb.verificationCode.updateMany).toHaveBeenCalledWith({
      where: { verificationCodeId: 'vc-1', verifiedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { attempts: { increment: 1 } }
    });
  });
});

describe('UserNotificationPreferenceRepository (una por usuario, horario como texto)', () => {
  it('findByUser devuelve las horas TIME como "HH:MM:SS"', async () => {
    mockDb.userNotificationPreference.findUnique.mockResolvedValue({
      userNotificationPreferenceId: 'p-1',
      quietHoursStart: toTime('22:00'),
      quietHoursEnd: toTime('07:30:00')
    });

    const pref = await userNotificationPreferenceRepository.findByUser('u-1');

    expect(pref).toMatchObject({ quietHoursStart: '22:00:00', quietHoursEnd: '07:30:00' });
    expect(mockDb.userNotificationPreference.findUnique).toHaveBeenCalledWith({ where: { userId: 'u-1' } });
  });

  it('findByUser devuelve null si el usuario nunca la configuró', async () => {
    mockDb.userNotificationPreference.findUnique.mockResolvedValue(null);
    await expect(userNotificationPreferenceRepository.findByUser('u-1')).resolves.toBeNull();
  });

  it('upsert convierte las horas y solo toca lo que vino', async () => {
    mockDb.userNotificationPreference.upsert.mockResolvedValue({
      userNotificationPreferenceId: 'p-9',
      quietHoursStart: null,
      quietHoursEnd: null
    });

    await userNotificationPreferenceRepository.upsert('u-1', { allowSms: false, quietHoursStart: '23:15' });

    const data = { allowSms: false, quietHoursStart: toTime('23:15') };
    expect(mockDb.userNotificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
      update: data,
      create: { userId: 'u-1', ...data }
    });
  });
});

describe('prisma-time', () => {
  it('ida y vuelta entre "HH:MM[:SS]" y TIME', () => {
    expect(fromTime(toTime('8:05'))).toBe('08:05:00');
    expect(fromTime(toTime('23:59:59'))).toBe('23:59:59');
    expect(toTime(null)).toBeNull();
    expect(toTime('')).toBeNull();
    expect(fromTime(null)).toBeNull();
    expect(() => toTime('25h')).toThrow(/Hora inválida/);
  });
});

describe('EmailBounceSuppressionRepository.registerHardBounce', () => {
  it('suma el rebote en la base y al llegar al umbral marca la dirección como suprimida', async () => {
    mockDb.emailBounceSuppression.upsert.mockResolvedValue({});
    mockDb.emailBounceSuppression.update
      .mockResolvedValueOnce({ bounceCount: 3, status: 'active', userId: null, suppressedAt: null })
      .mockResolvedValueOnce({});

    const result = await emailBounceSuppressionRepository.registerHardBounce('h-1', {
      userId: 'u-1',
      errorCode: 'Bounce',
      threshold: 3
    });

    expect(result).toEqual({ bounceCount: 3, suppressed: true, alreadySuppressed: false });
    expect(mockDb.emailBounceSuppression.update).toHaveBeenNthCalledWith(1, {
      where: { emailHash: 'h-1' },
      data: { bounceCount: { increment: 1 } }
    });
    expect(mockDb.emailBounceSuppression.update).toHaveBeenLastCalledWith({
      where: { emailHash: 'h-1' },
      data: expect.objectContaining({
        userId: 'u-1',
        status: 'suppressed',
        suppressedAt: expect.any(Date),
        lastErrorCode: 'Bounce'
      })
    });
  });
});
