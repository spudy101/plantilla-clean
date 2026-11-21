// tests/unit/modules/schemas/notification.regressions.test.ts
//
// Regresiones de bugs que destapó el tipado de modules/schemas/notification (fase 4 de la
// migración a TS). Repositorios y modelos se reemplazan por dobles.

jest.mock('../../shared/observability/logger.util', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
  logAudit: jest.fn()
}));
jest.mock('../audit/audit.service', () => ({ record: jest.fn() }));
jest.mock('./utils/notification-count.util', () => ({ emitCountUpdate: jest.fn() }));
jest.mock('../../shared/database/unit-of-work', () => ({ run: jest.fn((work: () => unknown) => work()) }));

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-sns', () => {
  const actual = jest.requireActual('@aws-sdk/client-sns');
  return { ...actual, SNSClient: jest.fn().mockImplementation(() => ({ send: mockSend })) };
});

import { fixture } from 'tests/helpers/mock';
import pushNotificationServiceModule from './services/push-notification.service';
const { PushNotificationService } = pushNotificationServiceModule;
import notificationCreationServiceModule from './services/notification-creation.service';
const { NotificationCreationService } = notificationCreationServiceModule;

beforeEach(() => jest.clearAllMocks());

describe('PushNotificationService.registrarDispositivo', () => {
  // Antes usaba this._snsClient (null hasta el primer uso del getter) → en un proceso recién
  // levantado registrar un dispositivo fallaba siempre con 500.
  it('funciona en frío, sin cliente SNS inyectado ni usado antes', async () => {
    mockSend.mockResolvedValue({ EndpointArn: 'arn:aws:sns:endpoint/1' });
    const service = new PushNotificationService();
    Object.defineProperty(service, 'PLATFORM_ARNS', { value: { ios: 'arn:ios', android: 'arn:android' } });

    await expect(service.registrarDispositivo('fcm-token', 'android', 'u-1')).resolves.toBe('arn:aws:sns:endpoint/1');
    // crear + leer atributos (+ habilitar, porque el doble no devuelve atributos)
    expect(mockSend).toHaveBeenCalled();
  });
});

describe('NotificationCreationService: entidad relacionada', () => {
  // Antes se escribía relatedEntity_type / relatedEntity_id: columnas inexistentes que Sequelize
  // descartaba, así que la notificación nunca guardaba a qué entidad apuntaba.
  it('guarda related_entity_type y related_entity_id', async () => {
    const notificationRepo = { create: jest.fn().mockResolvedValue({ notificationId: 'n-1' }) };
    const service = new NotificationCreationService(fixture({
      notificationRepo,
      userNotificationPreferenceRepo: { findByUser: jest.fn().mockResolvedValue(null) },
      notificationDeliveryService: { schedule: jest.fn().mockResolvedValue({ deliveries: [], sendNow: false }), sendInBackground: jest.fn() }
    }));
    const notificationType = { notificationTypeId: 'nt-1', category: null };

    await service._crearNotificacionIndividual('u-1', fixture(notificationType), 'T', 'B', { type: 'ApprovalRequest', id: 'ar-1' }, {});

    expect(notificationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ relatedEntityType: 'ApprovalRequest', relatedEntityId: 'ar-1' })
    );
  });
});
