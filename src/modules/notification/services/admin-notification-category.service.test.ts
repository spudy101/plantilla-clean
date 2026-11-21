// tests/unit/modules/admin/notification/services/admin-notification-category.service.test.ts
//
// NotificationCategoryService — CRUD de categorías de notificación (admin). Probamos list
// (paginación + filtros + auditoría), getById (404 vs DTO), create (código duplicado, camino feliz
// con commit y rollback ante error), update (404, sin cambios → rollback + DTO, camino feliz con
// commit) y remove (404, bloqueo si hay tipos asignados, borrado feliz). Repos (Prisma), paginación y
// DTOs se mockean; AppError es el real para conservar statusCode. Las escrituras son de una sola
// sentencia: no abren unidad de trabajo.

jest.mock('../repositories/notification-category.repository', () => ({
  findAllPaginated: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
  codeExists: jest.fn(),
  create: jest.fn(),
  delete: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../repositories/notification-type.repository', () => ({
  countByCategory: jest.fn()
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

jest.mock('../responses/admin-notification-category.response', () => ({
  NotificationCategoryAdminDTO: (cat: Loose) => ({ dto: 'category', id: cat.notificationCategoryId, code: cat.code }),
  ListNotificationCategoriesResponseDTO: (rows: Loose, metadata: Loose) => ({ data: rows, metadata })
}));

import { mocked, Loose } from 'tests/helpers/mock';
import categoryRepoModule from '../repositories/notification-category.repository';
const categoryRepo = mocked(categoryRepoModule);
import typeRepoModule from '../repositories/notification-type.repository';
const typeRepo = mocked(typeRepoModule);
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;
import service from './admin-notification-category.service';
import { CategoryListQuery } from '../requests/notification.request';

const ADMIN = 'admin-1';

describe('NotificationCategoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('pagina, filtra, audita y responde vía DTO de lista', async () => {
      categoryRepo.findAllPaginated.mockResolvedValue({ rows: [{ notificationCategoryId: 'c-1' }], count: 1 });

      const result = await service.list(CategoryListQuery.parse({ search: 'foo', isCritical: 'true' }), ADMIN);

      expect(categoryRepo.findAllPaginated).toHaveBeenCalledWith({ isCritical: true }, expect.objectContaining({ sortBy: 'createdAt' }), 'foo');
      expect(result.data).toHaveLength(1);
      expect(result.metadata.filters).toEqual({ search: 'foo', isCritical: true });
      expect(logAudit).toHaveBeenCalledWith('NOTIFICATION_CATEGORY_LIST_VIEWED', expect.objectContaining({ actorId: ADMIN, details: { totalItems: 1 } }));
    });
  });

  describe('getById', () => {
    it('lanza 404 si no existe', async () => {
      categoryRepo.findById.mockResolvedValue(null);
      await expect(service.getById('c-x', ADMIN)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('devuelve DTO y audita la vista', async () => {
      categoryRepo.findById.mockResolvedValue({ notificationCategoryId: 'c-1', code: 'ALERTS' });

      const result = await service.getById('c-1', ADMIN);

      expect(result).toMatchObject({ dto: 'category', code: 'ALERTS' });
      expect(logAudit).toHaveBeenCalledWith('NOTIFICATION_CATEGORY_VIEWED', expect.objectContaining({ actorId: ADMIN, details: { code: 'ALERTS' }, entityId: 'c-1' }));
    });
  });

  describe('create', () => {
    it('lanza badRequest si el código ya existe', async () => {
      categoryRepo.codeExists.mockResolvedValue(true);

      await expect(service.create({ code: 'alerts' }, ADMIN)).rejects.toMatchObject({ statusCode: 400 });
      expect(categoryRepo.create).not.toHaveBeenCalled();
    });

    it('normaliza el código, crea solo con los campos editables y audita', async () => {
      categoryRepo.codeExists.mockResolvedValue(false);
      categoryRepo.create.mockResolvedValue({ notificationCategoryId: 'c-9', code: 'ALERTS' });

      const result = await service.create({ code: '  alerts  ', name: 'Alertas', supportsEmail: true, campoAjeno: 1 }, ADMIN);

      expect(categoryRepo.create).toHaveBeenCalledWith({ code: 'ALERTS', name: 'Alertas', supportsEmail: true });
      expect(result).toMatchObject({ dto: 'category', code: 'ALERTS' });
      expect(logAudit).toHaveBeenCalledWith('NOTIFICATION_CATEGORY_CREATED', expect.objectContaining({ actorId: ADMIN, details: { code: 'ALERTS' }, entityId: 'c-9' }));
    });

    it('re-lanza si la creación falla y no audita', async () => {
      categoryRepo.codeExists.mockResolvedValue(false);
      categoryRepo.create.mockRejectedValue(new Error('db error'));

      await expect(service.create({ code: 'alerts' }, ADMIN)).rejects.toThrow('db error');
      expect(logAudit).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('lanza 404 si no existe, sin escribir', async () => {
      categoryRepo.findById.mockResolvedValue(null);

      await expect(service.update('c-x', { name: 'X' }, ADMIN)).rejects.toMatchObject({ statusCode: 404 });
      expect(categoryRepo.update).not.toHaveBeenCalled();
    });

    it('sin campos a actualizar devuelve el DTO actual sin escribir', async () => {
      categoryRepo.findById.mockResolvedValue({ notificationCategoryId: 'c-1', code: 'ALERTS' });

      const result = await service.update('c-1', { campoNoMapeado: 1 }, ADMIN);

      expect(categoryRepo.update).not.toHaveBeenCalled();
      expect(result).toMatchObject({ dto: 'category', code: 'ALERTS' });
    });

    it('actualiza solo los campos editables y audita', async () => {
      const updated = { notificationCategoryId: 'c-1', code: 'ALERTS' };
      categoryRepo.findById.mockResolvedValue({ notificationCategoryId: 'c-1', code: 'ALERTS' });
      categoryRepo.update.mockResolvedValue(updated);

      const result = await service.update('c-1', { name: 'Nuevo', isActive: false }, ADMIN);

      expect(categoryRepo.update).toHaveBeenCalledWith('c-1', { name: 'Nuevo', isActive: false });
      expect(result).toMatchObject({ dto: 'category' });
      expect(logAudit).toHaveBeenCalledWith('NOTIFICATION_CATEGORY_UPDATED', expect.objectContaining({ actorId: ADMIN, details: expect.objectContaining({ updatedFields: ['name', 'isActive'] }), entityId: 'c-1' })
      );
    });
  });

  describe('remove', () => {
    it('lanza 404 si no existe', async () => {
      categoryRepo.findById.mockResolvedValue(null);
      await expect(service.remove('c-x', ADMIN)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('lanza badRequest si la categoría tiene tipos asignados', async () => {
      categoryRepo.findById.mockResolvedValue({ notificationCategoryId: 'c-1', code: 'ALERTS' });
      typeRepo.countByCategory.mockResolvedValue(3);

      await expect(service.remove('c-1', ADMIN)).rejects.toMatchObject({ statusCode: 400 });
      expect(categoryRepo.delete).not.toHaveBeenCalled();
    });

    it('borra, audita y responde deleted:true', async () => {
      categoryRepo.findById.mockResolvedValue({ notificationCategoryId: 'c-1', code: 'ALERTS' });
      typeRepo.countByCategory.mockResolvedValue(0);

      const result = await service.remove('c-1', ADMIN);

      expect(categoryRepo.delete).toHaveBeenCalledWith('c-1');
      expect(result).toEqual({ notificationCategoryId: 'c-1', deleted: true });
      expect(logAudit).toHaveBeenCalledWith('NOTIFICATION_CATEGORY_DELETED', expect.objectContaining({ actorId: ADMIN, details: { code: 'ALERTS' }, entityId: 'c-1' }));
    });
  });
});
