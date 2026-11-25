// Reglas del dominio notification: plantillas, canales, horario de silencio, reintentos, email, OTP, supresión y
// el feed de rebotes. TypeScript puro, sin dobles.
import { categoryChanges, normalizeCategoryCode, renderContent, renderTemplate, typeChanges } from './notification-type';
import { endOfQuietHours, isInQuietHours, preferenceChanges } from './notification-preference';
import { MAX_ATTEMPTS, RETRY_DELAYS_MS, DELIVERY_LEASE_MS, channelsFor, groupByNotification, nextAttemptAfterFailure, planDeliveries } from './delivery';
import { composeEmail, wrapInLayout } from './email-message';
import { checkCode, truncatedCode, wrongCodeError } from './verification-code';
import { isEmailHash, isNewSuppression } from './email-suppression';
import { parseFeedEnvelope, readFeedEvent } from './bounce-feed';
import { chunks } from './broadcast';
import { toE164 } from './phone-number';
import { globalItem, mergeByCreatedAt, personalItem, unreadOnPage } from './notification';
import { CodeAlreadyUsedError, MalformedFeedError, TooManyCodeAttemptsError } from './errors';
import { category, globalNotification, personalNotification } from '../../../../tests/doubles/notification.doubles';

const at = (hh: number, mm = 0) => new Date(2026, 0, 1, hh, mm);

describe('plantillas', () => {
  it('reemplaza {{variable}} y deja las que no tienen valor', () => {
    expect(renderTemplate('Hola {{nombre}}, {{falta}} {{n}}', { nombre: 'Ana', n: 0 })).toBe('Hola Ana, {{falta}} 0');
    expect(renderTemplate(null, {})).toBe('');
    expect(renderTemplate('Sin datos {{x}}', null)).toBe('Sin datos {{x}}');
  });

  it('título y cuerpo desde las plantillas del tipo', () => {
    expect(renderContent({ titleTemplate: 'T {{a}}', bodyTemplate: 'B {{b}}' }, { a: 1, b: 2 })).toEqual({ title: 'T 1', body: 'B 2' });
  });

  it('edición: solo los campos permitidos que vinieron; el código en mayúsculas', () => {
    expect(categoryChanges({ name: 'X', code: 'NO', isCritical: false, other: 1, description: undefined })).toEqual({ name: 'X', isCritical: false });
    expect(typeChanges({ name: 'Y', titleTemplate: 'no', notificationCategoryId: null })).toEqual({ name: 'Y', notificationCategoryId: null });
    expect(normalizeCategoryCode('  security ')).toBe('SECURITY');
  });
});

describe('canales y horario de silencio', () => {
  it('lo que soporta la categoría y permite el usuario; sin categoría, push y email', () => {
    expect(channelsFor(category({ supportsSms: true }), { allowEmail: false })).toEqual(['push', 'sms']);
    expect(channelsFor(null, null)).toEqual(['push', 'email']);
  });

  it('una categoría crítica ignora las preferencias', () => {
    expect(channelsFor(category({ isCritical: true }), { allowPush: false, allowEmail: false })).toEqual(['push', 'email']);
  });

  it('horario de silencio, también cruzando medianoche', () => {
    const night = { quietHoursStart: '22:00:00', quietHoursEnd: '07:00:00' };
    expect(isInQuietHours(night, at(23))).toBe(true);
    expect(isInQuietHours(night, at(6, 59))).toBe(true);
    expect(isInQuietHours(night, at(7))).toBe(false);
    expect(isInQuietHours({ quietHoursStart: '13:00:00', quietHoursEnd: '14:00:00' }, at(13, 30))).toBe(true);
    expect(isInQuietHours(null, at(23))).toBe(false);
    expect(endOfQuietHours(night, at(23))).toEqual(new Date(2026, 0, 2, 7, 0));
    expect(endOfQuietHours(night, at(3))).toEqual(new Date(2026, 0, 1, 7, 0));
  });

  it('cambios de preferencia: solo lo que vino', () => {
    expect(preferenceChanges({ allowPush: false, quietHoursStart: null, allowSms: undefined })).toEqual({ allowPush: false, quietHoursStart: null });
  });
});

describe('plan de entregas y reintentos', () => {
  it('en horario de silencio se difiere al final (salvo crítica)', () => {
    const quiet = { quietHoursStart: '22:00:00', quietHoursEnd: '07:00:00' };
    const deferred = planDeliveries(category(), quiet, { canSendNow: true, now: at(23) });
    expect(deferred).toMatchObject({ channels: ['push', 'email'], sendNow: false, deferUntil: new Date(2026, 0, 2, 7, 0) });
    expect(deferred.firstAttemptAt).toEqual(deferred.deferUntil);

    const critical = planDeliveries(category({ isCritical: true }), quiet, { canSendNow: true, now: at(23) });
    expect(critical).toMatchObject({ sendNow: true, deferUntil: null });
    expect(critical.firstAttemptAt).toEqual(new Date(at(23).getTime() + DELIVERY_LEASE_MS));
  });

  it('dentro de una transacción no se envía ya: queda para el despachador', () => {
    expect(planDeliveries(category(), null, { canSendNow: false, now: at(12) })).toMatchObject({ sendNow: false, firstAttemptAt: at(12) });
  });

  it('espera creciente; definitivo o sin intentos, fallida', () => {
    expect(nextAttemptAfterFailure(1, false, 0)).toEqual(new Date(RETRY_DELAYS_MS[0]!));
    expect(nextAttemptAfterFailure(1, true, 0)).toBeNull();
    expect(nextAttemptAfterFailure(MAX_ATTEMPTS, false, 0)).toBeNull();
  });

  it('agrupa las entregas tomadas por notificación', () => {
    const d = (id: string, n: string) => ({ notificationDeliveryId: id, notificationId: n, channel: 'push' as const, attempts: 0 });
    expect([...groupByNotification([d('1', 'a'), d('2', 'b'), d('3', 'a')])].map(([n, ds]) => [n, ds.map(x => x.notificationDeliveryId)])).toEqual([
      ['a', ['1', '3']],
      ['b', ['2']]
    ]);
  });
});

describe('email', () => {
  it('compone asunto y cuerpo y lo envuelve en el layout de la categoría', () => {
    const email = composeEmail(
      { code: 'X', emailSubjectTemplate: 'Hola {{n}}', emailBodyTemplate: '<p>{{n}} $1</p>', category: { emailLayoutTemplate: '<main>{{content}}{{logo}}</main>' } },
      { n: 'Ana', logo: 'L' }
    );
    expect(email).toEqual({ status: 'ready', subject: 'Hola Ana', html: '<main><p>Ana $1</p>L</main>' });
  });

  it('no envuelve un documento completo; sin canal o sin plantillas no se envía', () => {
    expect(wrapInLayout('<!DOCTYPE html><html></html>', '<x>{{content}}</x>', {})).toBe('<!DOCTYPE html><html></html>');
    expect(composeEmail({ code: 'X', emailSubjectTemplate: 'a', emailBodyTemplate: 'b', category: { supportsEmail: false } }, {})).toEqual({
      status: 'unsupported',
      reason: 'channel'
    });
    expect(composeEmail({ code: 'X', emailSubjectTemplate: null, emailBodyTemplate: 'b' }, {})).toEqual({ status: 'unsupported', reason: 'templates' });
  });
});

describe('códigos OTP', () => {
  it('compara el código; usado o agotado, lanza', () => {
    expect(checkCode({ verifiedAt: null, attempts: 0, code: '111111' }, '111111')).toBe(true);
    expect(checkCode({ verifiedAt: null, attempts: null, code: '111111' }, '222222')).toBe(false);
    expect(() => checkCode({ verifiedAt: new Date(), attempts: 0, code: '1' }, '1')).toThrow(CodeAlreadyUsedError);
    expect(() => checkCode({ verifiedAt: null, attempts: 5, code: '1' }, '1')).toThrow(TooManyCodeAttemptsError);
  });

  it('cuenta los intentos que quedan y muestra el código parcial solo por SMS o en pruebas', () => {
    expect(wrongCodeError(0).message).toBe('Código inválido. Te quedan 4 intentos');
    expect(wrongCodeError(3).message).toBe('Código inválido. Te quedan 1 intento');
    expect(truncatedCode('phone', '123456', false)).toBe('****56');
    expect(truncatedCode('email', '123456', false)).toBeNull();
    expect(truncatedCode('email', '123456', true)).toBe('****56');
  });
});

describe('supresión y feed de rebotes', () => {
  it('reconoce un hash y la transición a suprimida', () => {
    expect(isEmailHash('a'.repeat(64))).toBe(true);
    expect(isEmailHash('ana@correo.co')).toBe(false);
    expect(isNewSuppression({ bounceCount: 3, suppressed: true, alreadySuppressed: false })).toBe(true);
    expect(isNewSuppression({ bounceCount: 4, suppressed: true, alreadySuppressed: true })).toBe(false);
  });

  it('lee el envelope de SNS y los rebotes permanentes', () => {
    expect(() => parseFeedEnvelope('no json')).toThrow(MalformedFeedError);
    const message = (ses: unknown) => ({ Type: 'Notification', Message: JSON.stringify(ses) });
    expect(
      readFeedEvent(message({ notificationType: 'Bounce', bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'a@x.co' }, {}], feedbackId: 'f' } }))
    ).toEqual({ kind: 'permanent_bounce', recipients: ['a@x.co'], recipientCount: 2, errorCode: 'Permanent', feedbackId: 'f' });
    expect(readFeedEvent(message({ eventType: 'Bounce', bounce: { bounceType: 'Transient' } }))).toEqual({
      kind: 'ignored',
      eventKind: 'Bounce',
      bounceType: 'Transient'
    });
    expect(() => readFeedEvent({ Message: '{' })).toThrow('El campo Message de SNS no es JSON válido');
  });
});

describe('bandeja, envío masivo y teléfonos', () => {
  it('mezcla por fecha y marca lo no leído de la página', () => {
    const older = personalNotification({ notificationId: 'p1', createdAt: new Date(1) });
    const newer = globalNotification({ globalNotificationId: 'g1', createdAt: new Date(2) });
    const items = mergeByCreatedAt([personalItem(older)], [globalItem(newer, [])], 'DESC');
    expect(items.map(i => i.kind)).toEqual(['global', 'personal']);
    expect(unreadOnPage(items, [])).toEqual({ personal: ['p1'], global: ['g1'] });
    expect(unreadOnPage(items, ['g1'])).toEqual({ personal: ['p1'], global: [] });
  });

  it('parte en tandas y arma el E.164', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(toE164('912345678', '+56')).toBe('+56912345678');
    expect(toE164('+56912345678', '+56')).toBe('+56912345678');
    expect(toE164('912345678', null)).toBe('912345678');
  });
});
