// tests/unit/modules/admin/records/legal/services/consent-type.service.test.ts
//
// ConsentTypeService — CRUD administrativo de tipos de consentimiento. Probamos las cuatro
// operaciones públicas (list/getById/create/update), sus guardas (not found / conflict) y el
// push best-effort al admin vía setImmediate. Mockeamos repo, DTOs, helpers de paginación,
// notificaciones, logger y constants; AppError se usa real (autocontenido).

// setImmediate en cuerpo de bloque para evitar no-promise-executor-return.
const flush = () =>
  new Promise(resolve => {
    setImmediate(resolve);
  });

jest.mock('../repositories/consent-type.repository', () => ({
  findAllPaginated: jest.fn(),
  findById: jest.fn(),
  findAnyByCode: jest.fn(),
  create: jest.fn(),
  update: jest.fn()
}));

jest.mock('../../notification/notify', () => ({
  notify: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../responses/consent-type.response', () => ({
  ConsentTypeListDTO: jest.fn(r => ({ list: r.code })),
  ConsentTypeDTO: jest.fn(r => ({ detail: r.code }))
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

jest.mock('../../../shared/infrastructure/config', () => ({
  notifications: { ses: { logoUrl: 'https://logo' } }
}));

import { mocked } from 'tests/helpers/mock';
import consentTypeRepositoryModule from '../repositories/consent-type.repository';
const consentTypeRepository = mocked(consentTypeRepositoryModule);
import NotificationUtilModule from '../../notification/notify';
const notifier = mocked(NotificationUtilModule);
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
import auditServiceModule from '../../audit/audit.service';
const { logger } = mocked(loggerUtilModule);
const logAudit = mocked(auditServiceModule).record;
import service from './consent-type.service';
import { ConsentTypeListQuery } from '../requests/legal.request';

const ADMIN_ID = 'admin-1';
const AUDIT_CTX = { adminUserId: ADMIN_ID };

describe('ConsentTypeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('pagina, mapea filas a DTO de lista, construye metadata y audita', async () => {
      consentTypeRepository.findAllPaginated.mockResolvedValue({
        rows: [{ code: 'PP' }, { code: 'CC' }],
        count: 2
      });

      const result = await service.list(ConsentTypeListQuery.parse({ search: 'x', sortBy: 'name', order: 'asc' }), ADMIN_ID);

      expect(consentTypeRepository.findAllPaginated).toHaveBeenCalledWith(
        {},
        { page: 1, limit: 10, offset: 0, sortBy: 'name', order: 'ASC' },
        'x'
      );
      expect(result.data).toEqual([{ list: 'PP' }, { list: 'CC' }]);
      expect(result.metadata).toMatchObject({
        pagination: { currentPage: 1, totalItems: 2 },
        sort: { field: 'name', order: 'ASC' },
        filters: { search: 'x' }
      });
      expect(logAudit).toHaveBeenCalledWith('CONSENT_TYPE_LIST_VIEWED', expect.objectContaining({ actorId: ADMIN_ID, details: expect.objectContaining({ totalItems: 2 }) })
      );
    });
  });

  describe('getById', () => {
    it('lanza notFound si el registro no existe', async () => {
      consentTypeRepository.findById.mockResolvedValue(null);
      await expect(service.getById('ct-1', ADMIN_ID)).rejects.toMatchObject({ statusCode: 404 });
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('devuelve el DTO de detalle y audita cuando existe', async () => {
      consentTypeRepository.findById.mockResolvedValue({ code: 'PP', consentTypeId: 'ct-1' });
      const result = await service.getById('ct-1', ADMIN_ID);
      expect(result).toEqual({ detail: 'PP' });
      expect(logAudit).toHaveBeenCalledWith('CONSENT_TYPE_DETAIL_VIEWED', expect.objectContaining({ actorId: ADMIN_ID, details: expect.objectContaining({ code: 'PP' }) })
      );
    });
  });

  describe('create', () => {
    it('lanza conflict si ya existe un tipo con el mismo código', async () => {
      consentTypeRepository.findAnyByCode.mockResolvedValue({ code: 'PP' });
      await expect(service.create({ code: 'PP', name: 'x' }, AUDIT_CTX)).rejects.toMatchObject({ statusCode: 409 });
      expect(consentTypeRepository.create).not.toHaveBeenCalled();
    });

    it('verifica la unicidad con el código ya en mayúsculas (el que se guarda)', async () => {
      consentTypeRepository.findAnyByCode.mockResolvedValue({ code: 'PP' });
      await expect(service.create({ code: 'pp', name: 'x' }, AUDIT_CTX)).rejects.toMatchObject({ statusCode: 409 });
      expect(consentTypeRepository.findAnyByCode).toHaveBeenCalledWith('PP');
    });

    it('crea con el código en mayúsculas, audita, loguea y notifica al admin', async () => {
      consentTypeRepository.findAnyByCode.mockResolvedValue(null);
      consentTypeRepository.create.mockResolvedValue({ consentTypeId: 'ct-9', code: 'PRIVACY', name: 'Política' });

      const result = await service.create({ code: 'privacy', name: 'Política' }, AUDIT_CTX);

      expect(consentTypeRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'PRIVACY', name: 'Política', isMandatory: true, isRevocable: false, isActive: true })
      );
      expect(result).toEqual({ detail: 'PRIVACY' });
      expect(logAudit).toHaveBeenCalledWith('CONSENT_TYPE_CREATED', expect.objectContaining({ actorId: ADMIN_ID }));

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CONSENT_TYPE_ADMIN_ACTION', userId: ADMIN_ID })
      );
    });

    it('respeta isMandatory:false e isRevocable:true del body', async () => {
      consentTypeRepository.findAnyByCode.mockResolvedValue(null);
      consentTypeRepository.create.mockResolvedValue({ consentTypeId: 'ct-9', code: 'CC' });

      await service.create({ code: 'cc', name: 'x', isMandatory: false, isRevocable: true }, AUDIT_CTX);

      expect(consentTypeRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isMandatory: false, isRevocable: true })
      );
    });

    it('no tumba la operación si la notificación al admin falla', async () => {
      consentTypeRepository.findAnyByCode.mockResolvedValue(null);
      consentTypeRepository.create.mockResolvedValue({ consentTypeId: 'ct-9', code: 'CC' });
      notifier.notify.mockRejectedValueOnce(new Error('push down'));

      await service.create({ code: 'cc', name: 'x' }, AUDIT_CTX);
      await flush();

      expect(logger.warn).toHaveBeenCalledWith(
        'Error enviando notificación admin consent-type',
        expect.objectContaining({ error: 'push down' })
      );
    });
  });

  describe('update', () => {
    it('lanza notFound si el registro no existe', async () => {
      consentTypeRepository.findById.mockResolvedValue(null);
      await expect(service.update('ct-1', { name: 'x' }, AUDIT_CTX)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('actualiza aplicando defaults del registro, audita, notifica y devuelve DTO', async () => {
      const updated = { code: 'PP', name: 'Nuevo' };
      const record = { code: 'PP', name: 'Viejo', description: 'desc', isActive: true };
      consentTypeRepository.findById.mockResolvedValue(record);
      consentTypeRepository.update.mockResolvedValue(updated);

      const result = await service.update('ct-1', { name: 'Nuevo' }, AUDIT_CTX);

      expect(consentTypeRepository.update).toHaveBeenCalledWith(
        'ct-1',
        expect.objectContaining({ name: 'Nuevo', description: 'desc', isActive: true })
      );
      expect(result).toEqual({ detail: 'PP' });
      expect(logAudit).toHaveBeenCalledWith('CONSENT_TYPE_UPDATED', expect.objectContaining({ actorId: ADMIN_ID }));

      await flush();
      expect(notifier.notify).toHaveBeenCalled();
    });
  });
});
