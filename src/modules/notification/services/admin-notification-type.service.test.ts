// tests/unit/modules/admin/notification/services/admin-notification-type.service.test.ts
//
// NotificationTypeService — gestión de tipos de notificación (admin) + envío de notificaciones
// generales/directas. Probamos list (paginación + auditoría), update (404, categoría inexistente,
// sin cambios → rollback + DTO, camino feliz con commit + auditoría), createGlobalNotification
// (crea + audita) y createDirectNotification (404 usuario, usuario inactivo, camino feliz). Repos,
// notification-creation, paginación, DTOs y la transacción de Sequelize se mockean; AppError es el
// real para conservar statusCode.

jest.mock('../repositories/notification-type.repository', () => ({
  findAllPaginated: jest.fn(),
  findById: jest.fn(),
  update: jest.fn()
}));

jest.mock('../repositories/notification-category.repository', () => ({
  findById: jest.fn()
}));

jest.mock('../../iam/repositories/user.repository', () => ({
  findByUserId: jest.fn()
}));

jest.mock('./notification-creation.service', () => ({
  crearNotificacion: jest.fn()
}));

jest.mock('../../../shared/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

jest.mock('../../../shared/constants', () => ({
  notifications: { ses: { logoUrl: 'https://logo.test/x.png' } }
}));

jest.mock('../responses/admin-notification-type.response', () => ({
  ListNotificationTypesResponseDTO: (rows: Loose, metadata: Loose) => ({ data: rows, metadata }),
  UpdateNotificationTypeResponseDTO: (nt: Loose) => ({ dto: 'type', code: nt.code }),
  CreateGlobalNotificationResponseDTO: (p: Loose) => ({ dto: 'global', ...p }),
  CreateDirectNotificationResponseDTO: (p: Loose) => ({ dto: 'direct', ...p })
}));

import { mocked, Loose, fixture } from 'tests/helpers/mock';
import typeRepoModule from '../repositories/notification-type.repository';
const typeRepo = mocked(typeRepoModule);
import categoryRepoModule from '../repositories/notification-category.repository';
const categoryRepo = mocked(categoryRepoModule);
import userRepoModule from '../../iam/repositories/user.repository';
const userRepo = mocked(userRepoModule);
import notificationCreationModule from './notification-creation.service';
const notificationCreation = mocked(notificationCreationModule);
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;
import service from './admin-notification-type.service';
import { TypeListQuery } from '../requests/notification.request';

const ADMIN = 'admin-1';

describe('NotificationTypeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('pagina, audita y responde vía DTO de lista', async () => {
      typeRepo.findAllPaginated.mockResolvedValue({ rows: [{ notificationTypeId: 't-1' }], count: 1 });

      const result = await service.list(TypeListQuery.parse({ search: 'foo' }), ADMIN);

      expect(typeRepo.findAllPaginated).toHaveBeenCalledWith({}, expect.objectContaining({ sortBy: 'createdAt', order: 'DESC', offset: 0 }), 'foo');
      expect(result.metadata).toMatchObject({ sort: { field: 'createdAt', order: 'DESC' }, filters: { search: 'foo' } });
      expect(result.data).toHaveLength(1);
      expect(logAudit).toHaveBeenCalledWith('NOTIFICATION_TYPE_LIST_VIEWED', expect.objectContaining({ actorId: ADMIN, details: expect.objectContaining({ totalItems: 1 }), entityType: 'NotificationType' })
      );
    });
  });

  describe('update', () => {
    it('lanza 404 si el tipo no existe, sin escribir', async () => {
      typeRepo.findById.mockResolvedValue(null);

      await expect(service.update('t-x', { name: 'X' }, ADMIN)).rejects.toMatchObject({ statusCode: 404 });
      expect(typeRepo.update).not.toHaveBeenCalled();
    });

    it('lanza badRequest si la categoría reasignada no existe, sin escribir', async () => {
      typeRepo.findById.mockResolvedValue({ code: 'X' });
      categoryRepo.findById.mockResolvedValue(null);

      await expect(service.update('t-1', { notificationCategoryId: 'c-x' }, ADMIN)).rejects.toMatchObject({ statusCode: 400 });
      expect(typeRepo.update).not.toHaveBeenCalled();
    });

    it('sin campos editables devuelve el DTO actual sin escribir', async () => {
      typeRepo.findById.mockResolvedValue({ code: 'X' });

      const result = await service.update('t-1', { campoNoMapeado: 1 }, ADMIN);

      expect(typeRepo.update).not.toHaveBeenCalled();
      expect(result).toMatchObject({ dto: 'type', code: 'X' });
    });

    it('actualiza solo los campos editables y audita', async () => {
      const updated = { code: 'X' };
      typeRepo.findById.mockResolvedValue({ code: 'X' });
      typeRepo.update.mockResolvedValue(updated);
      categoryRepo.findById.mockResolvedValue({ notificationCategoryId: 'c-1' });

      const result = await service.update('t-1', { name: 'Nuevo', priority: 5, notificationCategoryId: 'c-1' }, ADMIN);

      expect(typeRepo.update).toHaveBeenCalledWith('t-1', { name: 'Nuevo', notificationCategoryId: 'c-1' });
      expect(result).toMatchObject({ dto: 'type' });
      expect(logAudit).toHaveBeenCalledWith('NOTIFICATION_TYPE_UPDATED', expect.objectContaining({ actorId: ADMIN, details: expect.objectContaining({ updatedFields: ['name', 'notificationCategoryId'] }), entityId: 't-1' })
      );
    });

    it('re-lanza si el update falla y no audita', async () => {
      typeRepo.findById.mockResolvedValue({ code: 'X' });
      typeRepo.update.mockRejectedValue(new Error('db error'));

      await expect(service.update('t-1', { name: 'Nuevo' }, ADMIN)).rejects.toThrow('db error');
      expect(logAudit).not.toHaveBeenCalled();
    });
  });

  describe('createGlobalNotification', () => {
    it('crea la notificación global, audita y responde vía DTO', async () => {
      notificationCreation.crearNotificacion.mockResolvedValue({ globalNotificationId: 'g-1' });

      const result = await service.createGlobalNotification({ titulo: 'T', contenido: 'C', asunto: 'A' }, ADMIN);

      expect(notificationCreation.crearNotificacion).toHaveBeenCalledWith(
        expect.objectContaining({ tipoNotificacion: 'NOTIFICACION_GENERAL', userId: null })
      );
      expect(result).toMatchObject({ dto: 'global', titulo: 'T' });
      expect(logAudit).toHaveBeenCalledWith('GLOBAL_NOTIFICATION_SENT', expect.objectContaining({ actorId: ADMIN, details: { titulo: 'T' }, entityId: 'g-1', entityType: 'GlobalNotification' })
      );
    });
  });

  describe('createDirectNotification', () => {
    it('lanza 404 si el usuario no existe', async () => {
      userRepo.findByUserId.mockResolvedValue(null);

      await expect(service.createDirectNotification(fixture({ userId: 'u-x', titulo: 'T' }), ADMIN)).rejects.toMatchObject({ statusCode: 404 });
      expect(notificationCreation.crearNotificacion).not.toHaveBeenCalled();
    });

    it('lanza badRequest si el usuario está inactivo', async () => {
      userRepo.findByUserId.mockResolvedValue({ userId: 'u-1', isActive: false });

      await expect(service.createDirectNotification(fixture({ userId: 'u-1', titulo: 'T' }), ADMIN)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('crea la notificación directa, audita y responde vía DTO', async () => {
      userRepo.findByUserId.mockResolvedValue({ userId: 'u-1', isActive: true });
      notificationCreation.crearNotificacion.mockResolvedValue({ notificationId: 'n-1' });

      const result = await service.createDirectNotification({ userId: 'u-1', titulo: 'T', contenido: 'C', asunto: 'A' }, ADMIN);

      expect(notificationCreation.crearNotificacion).toHaveBeenCalledWith(
        expect.objectContaining({ tipoNotificacion: 'NOTIFICACION_GENERAL', userId: 'u-1' })
      );
      expect(result).toMatchObject({ dto: 'direct', userId: 'u-1' });
      expect(logAudit).toHaveBeenCalledWith('DIRECT_NOTIFICATION_SENT', expect.objectContaining({ actorId: ADMIN, details: { userId: 'u-1', titulo: 'T' }, entityId: 'n-1', entityType: 'Notification' })
      );
    });
  });
});
