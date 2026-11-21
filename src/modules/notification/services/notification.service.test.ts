// tests/unit/modules/shared-endpoints/notification/services/notification.service.test.ts
//
// NotificationService — fachada de lectura/escritura de notificaciones del usuario. Se prueba la
// orquestación sobre repos/utils mockeados: (1) getNotificationsList mezcla personales + globales,
// ordena, pagina, marca la página como leída dentro de una transacción y audita; (2)
// getPersonalNotifications marca las no leídas y emite el contador solo si hubo cambios; (3)
// getGlobalNotifications marca las globales no leídas; (4) getUnreadCount computa, emite por el
// emitter y audita; (5) computeUnreadCount suma personales + globales (tolerando no-array); (6)
// createNotification / createDirectNotification delegan y auditan; (7) rama de rollback de
// _markPageAsRead cuando la escritura falla. Los side-effects agendados con setImmediate se observan
// drenando la cola de macrotareas.

jest.mock('../../../shared/infrastructure/database/prisma', () => ({ __esModule: true, default: { $transaction: jest.fn() } }));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logAudit: jest.fn()
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

jest.mock('../repositories/notification.repository', () => ({
  findByUserPaginated: jest.fn(),
  findAllByUser: jest.fn(),
  countUnreadByUser: jest.fn(),
  markAsReadByIds: jest.fn().mockResolvedValue(1)
}));

jest.mock('../repositories/global-notification.repository', () => ({
  findActiveNotifications: jest.fn().mockResolvedValue([]),
  countUnreadByUser: jest.fn().mockResolvedValue(0)
}));

jest.mock('../repositories/global-notification-read.repository', () => ({
  getReadIdsByUser: jest.fn().mockResolvedValue([]),
  bulkMarkAsRead: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('./notification-creation.service', () => ({
  crearNotificacion: jest.fn(),
  crearNotificacionDirecta: jest.fn()
}));

jest.mock('../utils/notification-emitter.util', () => ({
  emit: jest.fn()
}));

jest.mock('../utils/notification-count.util', () => ({
  emitCountUpdate: jest.fn()
}));

import { managedTransaction } from 'tests/helpers/transaction';
import { mocked } from 'tests/helpers/mock';
import prismaModule from '../../../shared/infrastructure/database/prisma';
const prisma = mocked(prismaModule);
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
import auditServiceModule from '../../audit/audit.service';
const { logger } = mocked(loggerUtilModule);
const logAudit = mocked(auditServiceModule).record;
import notificationRepoModule from '../repositories/notification.repository';
const notificationRepo = mocked(notificationRepoModule);
import globalNotificationRepoModule from '../repositories/global-notification.repository';
const globalNotificationRepo = mocked(globalNotificationRepoModule);
import globalReadRepoModule from '../repositories/global-notification-read.repository';
const globalReadRepo = mocked(globalReadRepoModule);
import creationServiceModule from './notification-creation.service';
const creationService = mocked(creationServiceModule);
import NotificationEmitterModule from '../utils/notification-emitter.util';
const NotificationEmitter = mocked(NotificationEmitterModule);
import NotificationCountUtilModule from '../utils/notification-count.util';
const NotificationCountUtil = mocked(NotificationCountUtilModule);
import service from './notification.service';
import { GlobalNotificationListQuery, NotificationFeedQuery, PersonalNotificationListQuery } from '../requests/notification.request';

const USER = 'u-1';
const flush = () => new Promise(resolve => { setImmediate(resolve); });

function fakeTransaction() {
  return { commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn().mockResolvedValue(undefined) };
}

describe('NotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    notificationRepo.markAsReadByIds.mockResolvedValue(1);
    globalNotificationRepo.findActiveNotifications.mockResolvedValue([]);
    globalReadRepo.getReadIdsByUser.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(managedTransaction(fakeTransaction()));
  });

  describe('getNotificationsList', () => {
    it('mezcla y ordena DESC, marca la página como leída y audita', async () => {
      const tx = fakeTransaction();
      prisma.$transaction.mockImplementation(managedTransaction(tx));
      notificationRepo.findAllByUser.mockResolvedValue([
        { notificationId: 'n-1', createdAt: new Date('2024-01-02'), isRead: false }
      ]);
      globalNotificationRepo.findActiveNotifications.mockResolvedValue([
        { globalNotificationId: 'g-1', createdAt: new Date('2024-01-01') }
      ]);
      globalReadRepo.getReadIdsByUser.mockResolvedValue([]);

      const result = await service.getNotificationsList(USER, NotificationFeedQuery.parse({}));

      expect(result.totalItems).toBe(2);
      // Orden DESC: la personal (02-ene) va antes que la global (01-ene).
      expect(result.mixed[0]?.__type).toBe('personal');
      expect(result.mixed[1]?.__type).toBe('global');
      // Marca personal + global no leídas y confirma la transacción.
      expect(notificationRepo.markAsReadByIds).toHaveBeenCalled();
      expect(globalReadRepo.bulkMarkAsRead).toHaveBeenCalledWith(['g-1'], USER);
      expect(tx.commit).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('NOTIFICATION_LIST_VIEWED', expect.objectContaining({ actorId: USER, details: expect.objectContaining({ totalItems: 2 }), entityType: 'Notification' })
      );

      await flush();
      expect(NotificationCountUtil.emitCountUpdate).toHaveBeenCalledWith(USER);
    });

    it('loguea error si la escritura de marcado falla (sin propagar)', async () => {
      const tx = fakeTransaction();
      prisma.$transaction.mockImplementation(managedTransaction(tx));
      notificationRepo.findAllByUser.mockResolvedValue([
        { notificationId: 'n-1', createdAt: new Date('2024-01-02'), isRead: false }
      ]);
      globalNotificationRepo.findActiveNotifications.mockResolvedValue([]);
      globalReadRepo.getReadIdsByUser.mockResolvedValue([]);
      notificationRepo.markAsReadByIds.mockRejectedValue(new Error('db write fail'));

      const result = await service.getNotificationsList(USER, NotificationFeedQuery.parse({}));

      expect(result.totalItems).toBe(1);
      expect(tx.rollback).toHaveBeenCalled();
      expect(tx.commit).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'Error marcando notificaciones de página como leídas',
        expect.objectContaining({ error: 'db write fail' })
      );
    });
  });

  describe('getPersonalNotifications', () => {
    it('marca las no leídas, emite el contador y audita', async () => {
      notificationRepo.findByUserPaginated.mockResolvedValue({
        rows: [
          { notificationId: 'n-1', isRead: false },
          { notificationId: 'n-2', isRead: true }
        ],
        count: 2
      });

      const result = await service.getPersonalNotifications(USER, PersonalNotificationListQuery.parse({}));

      // solo las no leídas; el WHERE con IN lo arma el repositorio
      expect(notificationRepo.markAsReadByIds).toHaveBeenCalledWith(['n-1']);
      expect(logAudit).toHaveBeenCalledWith('NOTIFICATION_PERSONAL_LIST_VIEWED', expect.objectContaining({ actorId: USER, details: expect.objectContaining({ totalItems: 2 }) })
      );
      expect(result.count).toBe(2);

      await flush();
      expect(NotificationCountUtil.emitCountUpdate).toHaveBeenCalledWith(USER);
    });

    it('no marca ni emite cuando no hay no leídas', async () => {
      notificationRepo.findByUserPaginated.mockResolvedValue({
        rows: [{ notificationId: 'n-1', isRead: true }],
        count: 1
      });

      await service.getPersonalNotifications(USER, PersonalNotificationListQuery.parse({}));

      expect(notificationRepo.markAsReadByIds).not.toHaveBeenCalled();
      await flush();
      expect(NotificationCountUtil.emitCountUpdate).not.toHaveBeenCalled();
    });
  });

  describe('getGlobalNotifications', () => {
    it('marca las globales no leídas de la página y audita', async () => {
      globalNotificationRepo.findActiveNotifications.mockResolvedValue([
        { globalNotificationId: 'g-1', createdAt: new Date('2024-01-01') }
      ]);
      globalReadRepo.getReadIdsByUser.mockResolvedValue([]);

      const result = await service.getGlobalNotifications(USER, GlobalNotificationListQuery.parse({}));

      expect(globalReadRepo.bulkMarkAsRead).toHaveBeenCalledWith(['g-1'], USER);
      expect(result.totalItems).toBe(1);
      expect(logAudit).toHaveBeenCalledWith('NOTIFICATION_GLOBAL_LIST_VIEWED', expect.objectContaining({ actorId: USER, details: expect.objectContaining({ totalItems: 1 }), entityType: 'GlobalNotification' })
      );

      await flush();
      expect(NotificationCountUtil.emitCountUpdate).toHaveBeenCalledWith(USER);
    });

    it('no marca nada si todas las globales ya están leídas', async () => {
      globalNotificationRepo.findActiveNotifications.mockResolvedValue([
        { globalNotificationId: 'g-1', createdAt: new Date('2024-01-01') }
      ]);
      globalReadRepo.getReadIdsByUser.mockResolvedValue(['g-1']);

      await service.getGlobalNotifications(USER, GlobalNotificationListQuery.parse({}));

      expect(globalReadRepo.bulkMarkAsRead).not.toHaveBeenCalled();
    });
  });

  describe('getUnreadCount', () => {
    it('computa el total, lo emite por el emitter y audita', async () => {
      notificationRepo.countUnreadByUser.mockResolvedValue(3);
      globalNotificationRepo.countUnreadByUser.mockResolvedValue(2);

      const total = await service.getUnreadCount(USER);

      expect(total).toBe(5);
      expect(NotificationEmitter.emit).toHaveBeenCalledWith('count-updated', { userId: USER, count: 5 });
      expect(logAudit).toHaveBeenCalledWith('NOTIFICATION_UNREAD_COUNT_VIEWED', expect.objectContaining({ actorId: USER, details: { count: 5 } })
      );
    });
  });

  describe('computeUnreadCount', () => {
    it('suma personales + globales', async () => {
      notificationRepo.countUnreadByUser.mockResolvedValue(2);
      globalNotificationRepo.countUnreadByUser.mockResolvedValue(3);

      await expect(service.computeUnreadCount(USER)).resolves.toBe(5);
    });
  });

  describe('createNotification', () => {
    it('delega en el servicio de creación, loguea y audita', async () => {
      creationService.crearNotificacion.mockResolvedValue({ notificationId: 'n-1' });

      const result = await service.createNotification({ tipoNotificacion: 'WELCOME', userId: 'u-9' }, 'externo-x');

      expect(creationService.crearNotificacion).toHaveBeenCalledWith({ tipoNotificacion: 'WELCOME', userId: 'u-9' });
      expect(logger.info).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('NOTIFICATION_CREATED', expect.objectContaining({ actorId: null, details: expect.objectContaining({ tipoNotificacion: 'WELCOME', externalService: 'externo-x' }) })
      );
      expect(result).toEqual({ notificationId: 'n-1' });
    });
  });

  describe('createDirectNotification', () => {
    it('delega en crearNotificacionDirecta y audita', async () => {
      creationService.crearNotificacionDirecta.mockResolvedValue({ estadoSolicitud: 1 });

      const result = await service.createDirectNotification({ tipoNotificacion: 'CODIGO', email: 'a@b.cl' });

      expect(creationService.crearNotificacionDirecta).toHaveBeenCalledWith({ tipoNotificacion: 'CODIGO', email: 'a@b.cl' });
      expect(logAudit).toHaveBeenCalledWith('NOTIFICATION_DIRECT_CREATED', expect.objectContaining({ actorId: null, details: expect.objectContaining({ tipoNotificacion: 'CODIGO', email: 'a@b.cl' }) })
      );
      expect(result).toEqual({ estadoSolicitud: 1 });
    });
  });
});
