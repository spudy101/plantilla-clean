// NotificationBatchService — envío masivo de notificaciones globales por páginas de usuarios. Probamos:
// que avanza página a página guardando el cursor (y retoma desde él), el filtro por preferencia (una
// consulta por página, y la categoría crítica que la ignora), los contadores de enviados, el cierre
// (completed / failed sin tipo) y el despachador. Repos, servicios de canal y rate limit se mockean.

jest.mock('../../iam/repositories/user.repository', () => ({ findActivePageByRoleNames: jest.fn() }));
jest.mock('../repositories/global-notification.repository', () => ({
  claimDue: jest.fn(),
  recordPage: jest.fn(),
  finish: jest.fn()
}));
jest.mock('../repositories/user-notification-preference.repository', () => ({ findByUsers: jest.fn() }));
jest.mock('../repositories/user-push-token.repository', () => ({ findActiveByUsers: jest.fn(), deactivateTokens: jest.fn() }));
jest.mock('./email-notification.service', () => ({ enviarNotificacion: jest.fn() }));
jest.mock('./push-notification.service', () => ({ enviarPushMasivo: jest.fn() }));
jest.mock('./notification-rate-limit.service', () => ({
  checkSNSRateLimit: jest.fn().mockResolvedValue(undefined),
  checkSESRateLimit: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../../shared/infra/redis.util', () => ({ isAvailable: jest.fn(() => false) }));
jest.mock('../../../shared/security/encryption.util', () => ({ safeDecrypt: jest.fn((v: string) => v) }));
jest.mock('../../../shared/observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
  logAudit: jest.fn()
}));

import { mocked, Loose } from 'tests/helpers/mock';
import userRepoModule from '../../iam/repositories/user.repository';
const userRepo = mocked(userRepoModule);
import globalRepoModule from '../repositories/global-notification.repository';
const globalRepo = mocked(globalRepoModule);
import prefRepoModule from '../repositories/user-notification-preference.repository';
const prefRepo = mocked(prefRepoModule);
import tokenRepoModule from '../repositories/user-push-token.repository';
const tokenRepo = mocked(tokenRepoModule);
import emailServiceModule from './email-notification.service';
const emailService = mocked(emailServiceModule);
import pushServiceModule from './push-notification.service';
const pushService = mocked(pushServiceModule);
import rateLimitModule from './notification-rate-limit.service';
const rateLimit = mocked(rateLimitModule);
import batch, { LEASE_MS } from './notification-batch.service';

const user = (id: string, email: string | null = `${id}@x.cl`): Loose => ({ userId: id, person: { contact: { email } } });
/** n usuarios u-001, u-002... (orden por user_id) */
const users = (from: number, n: number) => Array.from({ length: n }, (_, i) => user(`u-${String(from + i).padStart(3, '0')}`));
const global = (overrides: Loose = {}): Loose => ({
  globalNotificationId: 'g-1',
  title: 'Aviso',
  body: 'Para todos',
  metadata: { x: 1 },
  sendPush: true,
  sendEmail: true,
  cursorUserId: null,
  notificationType: { code: 'NOTIFICACION_GENERAL', category: { isCritical: false } },
  ...overrides
});

beforeEach(() => {
  jest.clearAllMocks();
  prefRepo.findByUsers.mockResolvedValue(new Map());
  tokenRepo.findActiveByUsers.mockResolvedValue([]);
  pushService.enviarPushMasivo.mockImplementation(async (arns: string[]) => ({ success: arns.length, failed: 0, disabledEndpoints: [] }));
  emailService.enviarNotificacion.mockResolvedValue({ MessageId: 'm' });
});

describe('send', () => {
  it('recorre las páginas guardando el cursor y termina en completed', async () => {
    userRepo.findActivePageByRoleNames.mockResolvedValueOnce(users(1, 100)).mockResolvedValueOnce(users(101, 3));

    await batch.send(global({ sendPush: false }));

    expect(userRepo.findActivePageByRoleNames).toHaveBeenNthCalledWith(1, expect.any(Array), null, 100);
    expect(userRepo.findActivePageByRoleNames).toHaveBeenNthCalledWith(2, expect.any(Array), 'u-100', 100);
    // la segunda página vino incompleta: no se pide una tercera
    expect(userRepo.findActivePageByRoleNames).toHaveBeenCalledTimes(2);
    expect(globalRepo.recordPage).toHaveBeenNthCalledWith(1, 'g-1', {
      cursorUserId: 'u-100',
      pushSent: 0,
      emailSent: 100,
      leaseMs: LEASE_MS
    });
    expect(globalRepo.recordPage).toHaveBeenNthCalledWith(2, 'g-1', {
      cursorUserId: 'u-103',
      pushSent: 0,
      emailSent: 3,
      leaseMs: LEASE_MS
    });
    expect(globalRepo.finish).toHaveBeenCalledWith('g-1', 'completed');
  });

  it('retoma desde el cursor guardado', async () => {
    userRepo.findActivePageByRoleNames.mockResolvedValue([]);

    await batch.send(global({ cursorUserId: 'u-250' }));

    expect(userRepo.findActivePageByRoleNames).toHaveBeenCalledWith(expect.any(Array), 'u-250', 100);
    expect(globalRepo.recordPage).not.toHaveBeenCalled();
    expect(globalRepo.finish).toHaveBeenCalledWith('g-1', 'completed');
  });

  it('sin tipo no se puede enviar: failed', async () => {
    await batch.send(global({ notificationType: null }));

    expect(userRepo.findActivePageByRoleNames).not.toHaveBeenCalled();
    expect(globalRepo.finish).toHaveBeenCalledWith('g-1', 'failed');
  });

  it('si una página falla, no la da por enviada ni termina (la retoma el despachador)', async () => {
    userRepo.findActivePageByRoleNames.mockRejectedValue(new Error('db down'));

    await expect(batch.send(global())).rejects.toThrow('db down');
    expect(globalRepo.recordPage).not.toHaveBeenCalled();
    expect(globalRepo.finish).not.toHaveBeenCalled();
  });
});

describe('sendPage', () => {

  it('filtra por la preferencia de cada usuario, en una sola consulta', async () => {
    const page = [user('u-1'), user('u-2'), user('u-3', null)];
    prefRepo.findByUsers.mockResolvedValue(
      new Map([
        ['u-1', { allowPush: false, allowEmail: true }],
        ['u-2', { allowPush: true, allowEmail: false }]
      ])
    );
    tokenRepo.findActiveByUsers.mockResolvedValue([{ token: 'arn-2' }, { token: 'arn-3' }]);

    const result = await batch.sendPage(global(), page);

    expect(prefRepo.findByUsers).toHaveBeenCalledWith(['u-1', 'u-2', 'u-3']);
    expect(tokenRepo.findActiveByUsers).toHaveBeenCalledWith(['u-2', 'u-3']);
    expect(pushService.enviarPushMasivo).toHaveBeenCalledWith(['arn-2', 'arn-3'], 'Aviso', 'Para todos', { x: 1 });
    // u-2 no acepta email y u-3 no tiene: solo u-1
    expect(emailService.enviarNotificacion).toHaveBeenCalledTimes(1);
    expect(emailService.enviarNotificacion).toHaveBeenCalledWith(
      'u-1@x.cl',
      expect.objectContaining({ code: 'NOTIFICACION_GENERAL' }),
      { x: 1 }
    );
    expect(result).toEqual({ pushSent: 2, emailSent: 1 });
    expect(rateLimit.checkSNSRateLimit).toHaveBeenCalledWith(2);
    expect(rateLimit.checkSESRateLimit).toHaveBeenCalledWith(1);
  });

  it('desactiva los tokens que SNS dio de baja', async () => {
    tokenRepo.findActiveByUsers.mockResolvedValue([{ token: 'arn-1' }, { token: 'arn-2' }]);
    pushService.enviarPushMasivo.mockResolvedValue({ success: 1, failed: 1, disabledEndpoints: ['arn-2'] });

    const result = await batch.sendPage(global({ sendEmail: false }), [user('u-1')]);

    expect(result.pushSent).toBe(1);
    expect(tokenRepo.deactivateTokens).toHaveBeenCalledWith(['arn-2']);
  });

  it('una categoría crítica ignora la preferencia', async () => {
    prefRepo.findByUsers.mockResolvedValue(new Map([['u-1', { allowPush: false, allowEmail: false }]]));

    const result = await batch.sendPage(
      global({ sendPush: false, notificationType: { code: 'X', category: { isCritical: true } } }),
      [user('u-1')]
    );

    expect(result.emailSent).toBe(1);
  });

  it('solo cuenta los emails que salieron (no los rechazados ni las direcciones suprimidas)', async () => {
    emailService.enviarNotificacion.mockResolvedValueOnce({}).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('SES'));

    const result = await batch.sendPage(global({ sendPush: false }), [user('u-1'), user('u-2'), user('u-3')]);

    expect(result.emailSent).toBe(1);
  });

  it('respeta los canales de la global', async () => {
    const result = await batch.sendPage(global({ sendPush: false, sendEmail: false }), [user('u-1')]);

    expect(result).toEqual({ pushSent: 0, emailSent: 0 });
    expect(tokenRepo.findActiveByUsers).not.toHaveBeenCalled();
    expect(emailService.enviarNotificacion).not.toHaveBeenCalled();
  });
});

describe('dispatchDue', () => {
  it('sin envíos que retomar no abre la operación', async () => {
    globalRepo.claimDue.mockResolvedValue([]);
    const wrap = jest.fn();

    await expect(batch.dispatchDue(wrap)).resolves.toEqual({ resumed: 0 });
    expect(globalRepo.claimDue).toHaveBeenCalledWith(LEASE_MS);
    expect(wrap).not.toHaveBeenCalled();
  });

  it('retoma cada envío tomado', async () => {
    globalRepo.claimDue.mockResolvedValue([global({ cursorUserId: 'u-100' })]);
    userRepo.findActivePageByRoleNames.mockResolvedValue([]);

    await expect(batch.dispatchDue()).resolves.toEqual({ resumed: 1 });
    expect(userRepo.findActivePageByRoleNames).toHaveBeenCalledWith(expect.any(Array), 'u-100', 100);
    expect(globalRepo.finish).toHaveBeenCalledWith('g-1', 'completed');
  });
});
