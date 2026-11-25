// tests/integration/notifications.test.ts
//
// Grupo 3 de la fase 5 (docs/prisma-migration.md) contra Postgres real: notificaciones sobre Prisma.
// Cubre lo que un mock no prueba: el SQL crudo del despachador (tabla calificada con el esquema, SKIP
// LOCKED, reserva), las columnas TIME del horario de silencio, la preferencia única por usuario, las
// lecturas de globales con skipDuplicates y los contadores que se incrementan en la base.

import { randomUUID } from 'node:crypto';
import prisma from '../../src/shared/infrastructure/database/prisma';
import {
  PrismaGlobalNotificationRepository,
  PrismaPersonalNotificationRepository
} from '../../src/modules/notification/infrastructure/persistence/prisma-inbox.repositories';
import { PrismaDeliveryRepository } from '../../src/modules/notification/infrastructure/persistence/prisma-delivery.repository';
import {
  PrismaNotificationCategoryRepository,
  PrismaNotificationTypeRepository
} from '../../src/modules/notification/infrastructure/persistence/prisma-notification-catalog.repositories';
import { PrismaNotificationPreferenceRepository } from '../../src/modules/notification/infrastructure/persistence/prisma-preference.repository';
import { PrismaVerificationCodeRepository } from '../../src/modules/notification/infrastructure/persistence/prisma-verification-code.repository';
import { PrismaEmailSuppressionRepository } from '../../src/modules/notification/infrastructure/persistence/prisma-email-suppression.repository';
import { PrismaPushTokenRepository } from '../../src/modules/notification/infrastructure/persistence/prisma-push-token.repository';
import userRepository from '../../src/modules/iam/repositories/user.repository';
import { page as listPage } from '../helpers/page';

const notificationRepository = new PrismaPersonalNotificationRepository();
const deliveryRepository = new PrismaDeliveryRepository();
const notificationTypeRepository = new PrismaNotificationTypeRepository();
const notificationCategoryRepository = new PrismaNotificationCategoryRepository();
const globalNotificationRepository = new PrismaGlobalNotificationRepository();
const preferenceRepository = new PrismaNotificationPreferenceRepository();
const verificationCodeRepository = new PrismaVerificationCodeRepository();
const emailBounceSuppressionRepository = new PrismaEmailSuppressionRepository();
const userPushTokenRepository = new PrismaPushTokenRepository();

/** Una notificación personal mínima del usuario de prueba. */
const personal = (title: string) => ({
  userId,
  notificationTypeId: typeId,
  title,
  body: 'B',
  relatedEntityType: null,
  relatedEntityId: null,
  metadata: {}
});

const TAG = `notif-it-${randomUUID().slice(0, 8)}`;
const CODE = TAG.toUpperCase().replace(/-/g, '_');
let roleId: string;
let personId: string;
let userId: string;
let categoryId: string;
let typeId: string;

describe('Notificaciones · Prisma contra Postgres', () => {
  beforeAll(async () => {
    roleId = (await prisma.role.create({ data: { name: TAG } })).roleId;
    personId = (await prisma.person.create({ data: { firstName: 'Ada', lastName: TAG } })).personId;
    userId = (await prisma.user.create({ data: { username: TAG, personId, roleId } })).userId;
    categoryId = (await notificationCategoryRepository.create({ code: CODE, name: TAG })).notificationCategoryId;
    typeId = (
      await prisma.notificationType.create({
        data: {
          code: CODE,
          name: TAG,
          titleTemplate: 'Hola {{x}}',
          bodyTemplate: 'B',
          notificationCategoryId: categoryId,
          isActive: true
        }
      })
    ).notificationTypeId;
  });

  afterAll(async () => {
    await prisma.globalNotification.deleteMany({ where: { notificationTypeId: typeId } });
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.userNotificationPreference.deleteMany({ where: { userId } });
    await prisma.notificationType.deleteMany({ where: { notificationTypeId: typeId } });
    await prisma.notificationCategory.deleteMany({ where: { notificationCategoryId: categoryId } });
    await prisma.verificationCode.deleteMany({ where: { contactValue: `${TAG}@test.local` } });
    await prisma.emailBounceSuppression.deleteMany({ where: { emailHash: TAG } });
    await prisma.user.deleteMany({ where: { userId } });
    await prisma.person.deleteMany({ where: { personId } });
    await prisma.role.deleteMany({ where: { roleId } });
    await prisma.$disconnect();
  });

  it('categoría y tipo: el tipo trae su categoría', async () => {
    expect(await notificationCategoryRepository.findById(categoryId)).toMatchObject({ code: CODE, isCritical: false });

    const type = await notificationTypeRepository.findActiveByCode(CODE);
    expect(type?.category).toMatchObject({ code: CODE });
    expect(await notificationTypeRepository.countByCategory(categoryId)).toBe(1);
  });

  it('preferencia: una por usuario; el upsert conserva lo que no vino y el horario sale como "HH:MM:SS"', async () => {
    expect(await preferenceRepository.findByUser(userId)).toBeNull();

    await preferenceRepository.upsert(userId, { allowPush: true, quietHoursStart: '23:30', quietHoursEnd: '06:00' });
    await preferenceRepository.upsert(userId, { allowPush: false });

    expect(await prisma.userNotificationPreference.count({ where: { userId } })).toBe(1);
    expect(await preferenceRepository.findByUser(userId)).toMatchObject({
      allowPush: false,
      quietHoursStart: '23:30:00',
      quietHoursEnd: '06:00:00'
    });
  });

  it('entregas: el despachador toma solo las vencidas, las reserva y dos ciclos a la vez no toman la misma', async () => {
    const n = await notificationRepository.create(personal('T'));
    const past = new Date(Date.now() - 1000);
    const [push, email] = await deliveryRepository.createFor(n.notificationId, ['push', 'email'], past);
    // Una tercera, en el futuro (diferida por horario de silencio): no se toma
    const n2 = await notificationRepository.create(personal('T2'));
    await deliveryRepository.createFor(n2.notificationId, ['email'], new Date(Date.now() + 3_600_000));

    const [a, b] = await Promise.all([deliveryRepository.claimDue(10, 60_000), deliveryRepository.claimDue(10, 60_000)]);
    const mine = [...a, ...b].filter(d => d.notificationId === n.notificationId).map(d => d.notificationDeliveryId);
    expect(mine.sort()).toEqual([push!.notificationDeliveryId, email!.notificationDeliveryId].sort());
    expect([...a, ...b].some(d => d.notificationId === n2.notificationId)).toBe(false);

    // Reservadas: hasta que venza la reserva no se vuelven a tomar
    expect((await deliveryRepository.claimDue(10, 60_000)).some(d => d.notificationId === n.notificationId)).toBe(false);
    expect(
      (await prisma.notificationDelivery.findUnique({
        where: { notificationDeliveryId: push!.notificationDeliveryId }
      }))!.nextAttemptAt!.getTime()
    ).toBeGreaterThan(Date.now());

    // Resultados: fallo temporal → pendiente con un intento; enviado → sent
    await deliveryRepository.recordFailure(push!.notificationDeliveryId, {
      error: 'boom',
      errorCode: 'Throttling',
      nextAttemptAt: past
    });
    await deliveryRepository.markSent(email!.notificationDeliveryId);
    const rows = await deliveryRepository.findByNotification(n.notificationId);
    expect(rows.map(r => [r.channel, r.status, r.attempts])).toEqual([
      ['push', 'pending', 1],
      ['email', 'sent', 1]
    ]);
    expect((await deliveryRepository.claimDue(10, 60_000)).map(d => d.notificationDeliveryId)).toContain(
      push!.notificationDeliveryId
    );

    const admin = await deliveryRepository.list({ userId, status: 'sent', channel: null, from: null, to: null }, listPage());
    expect(admin.count).toBe(1);
    expect(admin.rows[0]?.notification.notificationType?.category).toMatchObject({ code: CODE });

    // Borrar la notificación borra sus entregas
    await prisma.notification.delete({ where: { notificationId: n.notificationId } });
    expect(await deliveryRepository.findByNotification(n.notificationId)).toEqual([]);
  });

  it('bandeja: marcar como leída una sola vez', async () => {
    const n = await notificationRepository.create(personal('T'));
    expect(await notificationRepository.markAsRead([n.notificationId])).toBe(1);
    expect(await notificationRepository.markAsRead([n.notificationId])).toBe(0);
  });

  it('global: leída una vez aunque se marque dos', async () => {
    const unreadBefore = await globalNotificationRepository.countUnreadByUser(userId);
    const g = await prisma.globalNotification.create({ data: { notificationTypeId: typeId, title: 'G', body: 'B', status: 'completed' } });
    expect(await globalNotificationRepository.countUnreadByUser(userId)).toBe(unreadBefore + 1);

    await globalNotificationRepository.markAsRead([g.globalNotificationId], userId);
    await globalNotificationRepository.markAsRead([g.globalNotificationId], userId);

    expect(await globalNotificationRepository.readIdsOf(userId)).toEqual([g.globalNotificationId]);
    expect(await globalNotificationRepository.countUnreadByUser(userId)).toBe(unreadBefore);
  });

  it('global: el despachador la toma una sola vez, guarda el avance y no la retoma terminada', async () => {
    const g = await globalNotificationRepository.create({
      notificationTypeId: typeId,
      title: 'G2',
      body: 'B',
      metadata: {},
      sendPush: true,
      sendEmail: false
    });
    const id = g.globalNotificationId;

    // Dos ciclos a la vez: solo uno la toma, con su tipo y categoría
    const [a, b] = await Promise.all([globalNotificationRepository.claimDue(60_000), globalNotificationRepository.claimDue(60_000)]);
    const taken = [...a, ...b].filter(x => x.globalNotificationId === id);
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({ status: 'processing', notificationType: { category: { code: CODE } } });
    // Reservada: no se vuelve a tomar
    expect((await globalNotificationRepository.claimDue(60_000)).some(x => x.globalNotificationId === id)).toBe(false);

    await globalNotificationRepository.recordProgress(id, { cursorUserId: userId, pushSent: 5, emailSent: 1, leaseMs: 60_000 });
    await globalNotificationRepository.recordProgress(id, { cursorUserId: userId, pushSent: 2, emailSent: 0, leaseMs: 60_000 });
    expect(await prisma.globalNotification.findUnique({ where: { globalNotificationId: id } })).toMatchObject({
      cursorUserId: userId,
      pushSentCount: 7,
      emailSentCount: 1
    });

    // Reserva vencida (proceso muerto): se retoma con su cursor
    await prisma.globalNotification.update({ where: { globalNotificationId: id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await globalNotificationRepository.claimDue(60_000)).find(x => x.globalNotificationId === id)?.cursorUserId).toBe(userId);

    await globalNotificationRepository.finish(id, 'completed');
    await prisma.globalNotification.update({ where: { globalNotificationId: id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await globalNotificationRepository.claimDue(60_000)).some(x => x.globalNotificationId === id)).toBe(false);
  });

  it('token push dado de baja: se desactiva y volver a registrar el dispositivo lo reactiva', async () => {
    const token = `arn:${TAG}`;
    await userPushTokenRepository.upsertToken(userId, token, 'android', `dev-${TAG}`);
    expect(await userPushTokenRepository.deactivate([token, 'arn:otro'])).toBe(1);
    expect(await userPushTokenRepository.findActiveByUser(userId)).toEqual([]);
    // ya inactivo: no cuenta de nuevo
    expect(await userPushTokenRepository.deactivate([token])).toBe(0);

    await userPushTokenRepository.upsertToken(userId, token, 'android', `dev-${TAG}`);
    expect((await userPushTokenRepository.findActiveByUser(userId)).map(t => t.token)).toEqual([token]);
  });

  it('usuarios por páginas: orden por user_id y a partir del cursor', async () => {
    const page = await userRepository.findActivePageByRoleNames([TAG], null, 10);
    expect(page.map(u => u.userId)).toEqual([userId]);
    expect(await userRepository.findActivePageByRoleNames([TAG], userId, 10)).toEqual([]);
  });

  it('código de verificación: rate limit, intentos y verificación', async () => {
    const contact = `${TAG}@test.local`;
    expect(await verificationCodeRepository.secondsUntilNewCode('email', contact)).toBe(0);
    const vc = await verificationCodeRepository.create({
      type: 'email',
      contactValue: contact,
      code: '123456',
      expiresAt: new Date(Date.now() + 60_000)
    });
    const wait = await verificationCodeRepository.secondsUntilNewCode('email', contact);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);

    expect(await verificationCodeRepository.incrementAttempts(vc.verificationCodeId)).toBe(1);
    expect((await verificationCodeRepository.findActiveByContact('email', contact))?.attempts).toBe(1);

    await verificationCodeRepository.markAsVerified(vc.verificationCodeId);
    expect(await verificationCodeRepository.findActiveByContact('email', contact)).toBeNull();
    expect(await verificationCodeRepository.incrementAttempts(vc.verificationCodeId)).toBe(0);
    expect((await verificationCodeRepository.findVerifiedByContact('email', contact))?.verificationCodeId).toBe(
      vc.verificationCodeId
    );
  });

  it('suppression list: al tercer rebote duro la dirección queda suprimida; lift la libera', async () => {
    const opts = { userId: null, errorCode: 'Bounce', threshold: 3 };
    expect(await emailBounceSuppressionRepository.registerHardBounce(TAG, opts)).toMatchObject({
      bounceCount: 1,
      suppressed: false
    });
    await emailBounceSuppressionRepository.registerHardBounce(TAG, opts);
    expect(await emailBounceSuppressionRepository.registerHardBounce(TAG, opts)).toEqual({
      bounceCount: 3,
      suppressed: true,
      alreadySuppressed: false
    });
    expect(await emailBounceSuppressionRepository.isSuppressed(TAG)).toBe(true);

    await emailBounceSuppressionRepository.lift(TAG);
    expect(await emailBounceSuppressionRepository.isSuppressed(TAG)).toBe(false);
  });
});
