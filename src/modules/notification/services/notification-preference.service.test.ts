// NotificationPreferenceService — una sola preferencia por usuario: get (con valores por defecto si
// nunca la configuró) y update (solo los campos enviados, auditado). Repo y auditoría se mockean.

jest.mock('../repositories/user-notification-preference.repository', () => ({
  findByUser: jest.fn(),
  upsert: jest.fn()
}));
jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() }
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

import { mocked } from 'tests/helpers/mock';
import prefRepoModule from '../repositories/user-notification-preference.repository';
const prefRepo = mocked(prefRepoModule);
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;
import service from './notification-preference.service';

const stored = {
  userNotificationPreferenceId: 'pref-1',
  userId: 'user-1',
  allowPush: false,
  allowEmail: true,
  allowSms: true,
  quietHoursStart: '22:00:00',
  quietHoursEnd: '07:00:00',
  updatedAt: new Date('2026-01-01T00:00:00Z')
};

beforeEach(() => jest.clearAllMocks());

describe('getPreference', () => {
  it('devuelve la preferencia guardada', async () => {
    prefRepo.findByUser.mockResolvedValue(stored);

    await expect(service.getPreference('user-1')).resolves.toEqual({
      configured: true,
      allowPush: false,
      allowEmail: true,
      allowSms: true,
      quietHoursStart: '22:00:00',
      quietHoursEnd: '07:00:00',
      updatedAt: stored.updatedAt
    });
    expect(logAudit).toHaveBeenCalledWith(
      'NOTIFICATION_PREFERENCES_VIEWED',
      expect.objectContaining({ actorId: 'user-1', entityId: 'pref-1' })
    );
  });

  it('si nunca la configuró, devuelve los valores por defecto (todo permitido, sin silencio)', async () => {
    prefRepo.findByUser.mockResolvedValue(null);

    await expect(service.getPreference('user-1')).resolves.toEqual({
      configured: false,
      allowPush: true,
      allowEmail: true,
      allowSms: true,
      quietHoursStart: null,
      quietHoursEnd: null,
      updatedAt: null
    });
  });
});

describe('updatePreference', () => {
  it('solo guarda los campos enviados y audita el cambio', async () => {
    prefRepo.upsert.mockResolvedValue(stored);

    await service.updatePreference({ allowPush: false, quietHoursStart: '22:00', allowSms: undefined }, 'user-1');

    expect(prefRepo.upsert).toHaveBeenCalledWith('user-1', { allowPush: false, quietHoursStart: '22:00' });
    expect(logAudit).toHaveBeenCalledWith('NOTIFICATION_GLOBAL_PREFERENCE_UPDATED', {
      actorId: 'user-1',
      details: { allowPush: false, quietHoursStart: '22:00' },
      entityId: 'pref-1',
      entityType: 'UserNotificationPreference',
      entityTable: 'user_notification_preferences'
    });
  });
});
