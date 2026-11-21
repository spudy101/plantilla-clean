// tests/unit/modules/schemas/notification/services/notification-creation.service.test.ts
//
// NotificationCreationService — núcleo del pipeline de creación de notificaciones. Probamos la
// lógica de orquestación, no el acceso a datos: (1) validaciones de entrada (tipo/email requeridos
// y tipo inexistente → AppError 400/404); (2) el envío directo por email descifra el destino y
// delega en el servicio de email; (3) el camino individual crea la fila in-app, resuelve las
// preferencia del usuario y, en la misma transacción, las entregas por canal; envía tras confirmar; (4) el camino global crea la fila global y despacha el procesamiento masivo; (5) la
// propagación de errores del repositorio. Repos, utils, servicios de envío/scheduler/batch, logger
// y el modelo se mockean para aislar la lógica; AppError es el real para poder assertar statusCode.

jest.mock('../repositories/notification.repository', () => ({
  create: jest.fn()
}));

jest.mock('../repositories/global-notification.repository', () => ({
  create: jest.fn()
}));

jest.mock('../repositories/notification-type.repository', () => ({
  findByCode: jest.fn()
}));

jest.mock('../repositories/user-notification-preference.repository', () => ({
  findByUser: jest.fn()
}));

jest.mock('../utils/notification-count.util', () => ({
  emitCountUpdate: jest.fn(),
  emitGlobalCountInvalidation: jest.fn()
}));

jest.mock('../utils/notification-content.util', () => ({
  generarContenido: jest.fn().mockReturnValue({ title: 'Título generado', body: 'Cuerpo generado' })
}));

jest.mock('./notification-delivery.service', () => ({
  schedule: jest.fn(),
  sendInBackground: jest.fn()
}));

// La transacción se simula ejecutando el trabajo; activeUnit dice si quien llama ya está en una.
jest.mock('../../../shared/database/unit-of-work', () => ({
  run: jest.fn((work: () => unknown) => work())
}));

jest.mock('../../../shared/database/transaction-context', () => ({
  activeUnit: jest.fn(() => null)
}));

// Servicios cargados de forma perezosa (require dentro del método) — igualmente interceptables.
jest.mock('./email-notification.service', () => ({
  enviarNotificacion: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('./notification-batch.service', () => ({
  LEASE_MS: 300000,
  sendInBackground: jest.fn()
}));

jest.mock('../../../shared/security/encryption.util', () => ({
  safeDecrypt: jest.fn(value => `dec(${value})`)
}));

jest.mock('../../../shared/observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() }
}));

import { mocked, fixture } from 'tests/helpers/mock';
import notificationRepoModule from '../repositories/notification.repository';
const notificationRepo = mocked(notificationRepoModule);
import globalNotificationRepoModule from '../repositories/global-notification.repository';
const globalNotificationRepo = mocked(globalNotificationRepoModule);
import notificationTypeRepoModule from '../repositories/notification-type.repository';
const notificationTypeRepo = mocked(notificationTypeRepoModule);
import userPreferenceRepoModule from '../repositories/user-notification-preference.repository';
const userPreferenceRepo = mocked(userPreferenceRepoModule);
import NotificationCountUtilModule from '../utils/notification-count.util';
const NotificationCountUtil = mocked(NotificationCountUtilModule);
import NotificationContentUtilModule from '../utils/notification-content.util';
const NotificationContentUtil = mocked(NotificationContentUtilModule);
import deliveryServiceModule from './notification-delivery.service';
const deliveryService = mocked(deliveryServiceModule);
import unitOfWorkModule from '../../../shared/database/unit-of-work';
const unitOfWork = mocked(unitOfWorkModule);
import txContextModule from '../../../shared/database/transaction-context';
const txContext = mocked(txContextModule);
import emailServiceModule from './email-notification.service';
const emailService = mocked(emailServiceModule);
import batchServiceModule from './notification-batch.service';
const batchService = mocked(batchServiceModule);
import EncryptionUtilModule from '../../../shared/security/encryption.util';
const EncryptionUtil = mocked(EncryptionUtilModule);
import creationService from './notification-creation.service';

// Los envíos/side-effects se agendan con setImmediate; drenamos la cola para observarlos.
const flush = () =>
  new Promise(resolve => {
    setImmediate(resolve);
  });

function notificationType(overrides = {}) {
  return {
    notificationTypeId: 't-1',
    code: 'WELCOME',
    category: null,
    ...overrides
  };
}

describe('NotificationCreationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    NotificationContentUtil.generarContenido.mockReturnValue({ title: 'Título generado', body: 'Cuerpo generado' });
    EncryptionUtil.safeDecrypt.mockImplementation(value => `dec(${value})`);
  });

  describe('crearNotificacionDirecta', () => {
    it('lanza badRequest (400) si falta tipoNotificacion', async () => {
      await expect(creationService.crearNotificacionDirecta(fixture({ email: 'a@b.cl' }))).rejects.toMatchObject({
        statusCode: 400
      });
    });

    it('lanza badRequest (400) si falta email', async () => {
      await expect(creationService.crearNotificacionDirecta(fixture({ tipoNotificacion: 'WELCOME' }))).rejects.toMatchObject({
        statusCode: 400
      });
    });

    it('lanza notFound (404) si el tipo de notificación no existe', async () => {
      notificationTypeRepo.findByCode.mockResolvedValue(null);
      await expect(creationService.crearNotificacionDirecta({ tipoNotificacion: 'NOPE', email: 'a@b.cl' })).rejects.toMatchObject(
        { statusCode: 404 }
      );
    });

    it('descifra el email y delega en el servicio de email (camino feliz)', async () => {
      const type = notificationType();
      notificationTypeRepo.findByCode.mockResolvedValue(type);

      const result = await creationService.crearNotificacionDirecta({
        tipoNotificacion: 'WELCOME',
        email: 'iv:tag:cipher',
        metadata: { nombre: 'Ana' }
      });

      expect(EncryptionUtil.safeDecrypt).toHaveBeenCalledWith('iv:tag:cipher');
      expect(emailService.enviarNotificacion).toHaveBeenCalledWith('dec(iv:tag:cipher)', type, { nombre: 'Ana' });
      expect(result).toEqual({ estadoSolicitud: 1, message: expect.any(String) });
    });

    it('propaga el error si el servicio de email falla', async () => {
      notificationTypeRepo.findByCode.mockResolvedValue(notificationType());
      emailService.enviarNotificacion.mockRejectedValueOnce(new Error('SES caído'));

      await expect(creationService.crearNotificacionDirecta({ tipoNotificacion: 'WELCOME', email: 'a@b.cl' })).rejects.toThrow(
        'SES caído'
      );
    });
  });

  describe('crearNotificacion', () => {
    it('lanza badRequest (400) si falta tipoNotificacion', async () => {
      await expect(creationService.crearNotificacion(fixture({ userId: 'u-1' }))).rejects.toMatchObject({ statusCode: 400 });
    });

    it('lanza notFound (404) si el tipo de notificación no existe', async () => {
      notificationTypeRepo.findByCode.mockResolvedValue(null);
      await expect(creationService.crearNotificacion({ tipoNotificacion: 'NOPE', userId: 'u-1' })).rejects.toMatchObject({
        statusCode: 404
      });
    });

    describe('individual (userId presente)', () => {
      beforeEach(() => {
        deliveryService.schedule.mockResolvedValue({ deliveries: [{ notificationDeliveryId: 'd-1' }], sendNow: true });
      });

      it('crea la notificación in-app y sus entregas en una transacción, envía tras confirmar y devuelve notificationId', async () => {
        const type = notificationType();
        notificationTypeRepo.findByCode.mockResolvedValue(type);
        notificationRepo.create.mockResolvedValue({ notificationId: 'n-1' });
        userPreferenceRepo.findByUser.mockResolvedValue({ allowPush: false });

        const result = await creationService.crearNotificacion({
          tipoNotificacion: 'WELCOME',
          userId: 'u-1',
          metadata: { foo: 'bar' }
        });

        expect(unitOfWork.run).toHaveBeenCalledTimes(1);
        expect(notificationRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ userId: 'u-1', notificationTypeId: 't-1', metadata: { foo: 'bar' } })
        );
        expect(deliveryService.schedule).toHaveBeenCalledWith('n-1', type, { allowPush: false }, { canSendNow: true });
        expect(deliveryService.sendInBackground).toHaveBeenCalledWith(
          [{ notificationDeliveryId: 'd-1' }],
          expect.objectContaining({ notificationId: 'n-1', notificationType: type })
        );
        expect(result).toMatchObject({ estadoSolicitud: 1, notificationId: 'n-1' });

        await flush();
        expect(NotificationCountUtil.emitCountUpdate).toHaveBeenCalledWith('u-1');
      });

      it('no envía desde aquí si las entregas quedaron para después (horario de silencio)', async () => {
        notificationTypeRepo.findByCode.mockResolvedValue(notificationType());
        notificationRepo.create.mockResolvedValue({ notificationId: 'n-2' });
        userPreferenceRepo.findByUser.mockResolvedValue(null);
        deliveryService.schedule.mockResolvedValue({ deliveries: [{ notificationDeliveryId: 'd-2' }], sendNow: false });

        await creationService.crearNotificacion({ tipoNotificacion: 'PROMO', userId: 'u-1' });

        expect(deliveryService.sendInBackground).not.toHaveBeenCalled();
      });

      it('dentro de la unidad de trabajo de quien llama no envía ya: lo hará el despachador tras el commit', async () => {
        notificationTypeRepo.findByCode.mockResolvedValue(notificationType());
        notificationRepo.create.mockResolvedValue({ notificationId: 'n-3' });
        userPreferenceRepo.findByUser.mockResolvedValue(null);
        txContext.activeUnit.mockReturnValueOnce({} as never);

        await creationService.crearNotificacion({ tipoNotificacion: 'WELCOME', userId: 'u-1' });

        expect(deliveryService.schedule).toHaveBeenCalledWith('n-3', expect.anything(), null, { canSendNow: false });
      });

      it('propaga el error si el repositorio de notificaciones falla (y no crea entregas)', async () => {
        notificationTypeRepo.findByCode.mockResolvedValue(notificationType());
        notificationRepo.create.mockRejectedValue(new Error('db down'));

        await expect(creationService.crearNotificacion({ tipoNotificacion: 'WELCOME', userId: 'u-1' })).rejects.toThrow(
          'db down'
        );
        expect(deliveryService.schedule).not.toHaveBeenCalled();
        expect(deliveryService.sendInBackground).not.toHaveBeenCalled();
      });
    });

    describe('global (userId ausente)', () => {
      it('crea la global ya reservada, lanza el envío masivo y devuelve globalNotificationId', async () => {
        const type = notificationType({ category: { supportsPush: true, supportsEmail: false } });
        notificationTypeRepo.findByCode.mockResolvedValue(type);
        globalNotificationRepo.create.mockResolvedValue({ globalNotificationId: 'g-1' });
        const before = Date.now();

        const result = await creationService.crearNotificacion({ tipoNotificacion: 'BROADCAST', metadata: { x: 1 } });

        expect(globalNotificationRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ notificationTypeId: 't-1', sendPush: true, sendEmail: false, status: 'processing' })
        );
        const { lockedUntil } = globalNotificationRepo.create.mock.calls[0]![0];
        expect(lockedUntil.getTime()).toBeGreaterThanOrEqual(before + 300000);
        expect(batchService.sendInBackground).toHaveBeenCalledWith({ globalNotificationId: 'g-1', notificationType: type });
        expect(result).toMatchObject({ estadoSolicitud: 1, globalNotificationId: 'g-1' });

        await flush();
        expect(NotificationCountUtil.emitGlobalCountInvalidation).toHaveBeenCalled();
      });

      it('dentro de la unidad de trabajo de quien llama queda pendiente para el despachador', async () => {
        notificationTypeRepo.findByCode.mockResolvedValue(notificationType());
        globalNotificationRepo.create.mockResolvedValue({ globalNotificationId: 'g-2' });
        txContext.activeUnit.mockReturnValueOnce({} as never);

        await creationService.crearNotificacion({ tipoNotificacion: 'BROADCAST' });

        expect(globalNotificationRepo.create.mock.calls[0]![0]).not.toHaveProperty('lockedUntil');
        expect(batchService.sendInBackground).not.toHaveBeenCalled();
      });

      it('propaga el error si el repositorio global falla', async () => {
        notificationTypeRepo.findByCode.mockResolvedValue(notificationType());
        globalNotificationRepo.create.mockRejectedValue(new Error('db down'));

        await expect(creationService.crearNotificacion({ tipoNotificacion: 'BROADCAST' })).rejects.toThrow('db down');
      });
    });
  });
});
