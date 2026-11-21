// tests/unit/modules/admin/records/audit/services/admin-audit-alert.service.test.ts
//
// AdminAuditAlertService — gestión de alertas de auditoría desde el panel admin. Probamos la
// orquestación: list() arma filtros + paginación y expone pendingCount; acknowledge() lanza 404 si
// no marcó nada y, si marcó, audita y devuelve el registro; acknowledgeBulk() reporta
// {acknowledged, requested}. Repos, DTOs, paginación, notificaciones y logger se mockean para
// aislar la lógica del servicio. La notificación se dispara en setImmediate → se vacía la cola de
// macrotareas antes de assertar.

jest.mock('../repositories/audit-alert.repository', () => ({
  findAllFiltered: jest.fn(),
  countPending: jest.fn(),
  acknowledge: jest.fn(),
  acknowledgeBulk: jest.fn(),
  findById: jest.fn()
}));

jest.mock('../../notification/notify', () => ({
  notify: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() }
}));
jest.mock('../audit.service', () => ({ record: jest.fn() }));

// Paginación reducida a valores deterministas para no depender de su parsing interno.
jest.mock('../../../shared/infrastructure/config', () => ({
  notifications: { ses: { logoUrl: 'https://logo.test/x.png' } }
}));

// DTOs a identidad/passthrough para no acoplar a su forma interna.
jest.mock('../responses/admin-audit-alert.response', () => ({
  AuditAlertListDTO: (row: Loose) => ({ dto: true, ...row })
}));

import { mocked, Loose } from 'tests/helpers/mock';
import auditAlertRepoModule from '../repositories/audit-alert.repository';
const auditAlertRepo = mocked(auditAlertRepoModule);
import notificationCreationModule from '../../notification/notify';
const notificationCreation = mocked(notificationCreationModule);
import auditServiceModule from '../audit.service';
const logAudit = mocked(auditServiceModule).record;
import service from './admin-audit-alert.service';
import { AuditAlertListQuery } from '../requests/audit.request';

const ADMIN = 'admin-1';
const flushMacrotasks = () => new Promise(resolve => { setImmediate(resolve); });

describe('AdminAuditAlertService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('devuelve alertas mapeadas + metadata con pendingCount y audita el listado', async () => {
      auditAlertRepo.findAllFiltered.mockResolvedValue({
        rows: [{ audit_alert_id: 'a-1' }, { audit_alert_id: 'a-2' }],
        count: 2
      });
      auditAlertRepo.countPending.mockResolvedValue(5);

      const result = await service.list(AuditAlertListQuery.parse({ acknowledged: 'false', dateFrom: '2026-11-01' }), ADMIN);

      // El esquema ya convirtió acknowledged a boolean y la fecha a Date (antes la fecha se perdía)
      expect(auditAlertRepo.findAllFiltered).toHaveBeenCalledWith(
        { acknowledged: false, dateFrom: new Date('2026-11-01'), dateTo: undefined, action: undefined, category: undefined },
        expect.objectContaining({ limit: 10, offset: 0, sortBy: 'createdAt', order: 'DESC' })
      );
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toMatchObject({ dto: true, audit_alert_id: 'a-1' });
      expect(result.metadata).toMatchObject({
        pagination: { totalItems: 2 },
        sort: { field: 'createdAt', order: 'DESC' },
        filters: { acknowledged: false, dateFrom: new Date('2026-11-01') },
        pendingCount: 5
      });
      expect(logAudit).toHaveBeenCalledWith('AUDIT_ALERT_LISTED', expect.objectContaining({ actorId: ADMIN, details: { totalItems: 2, pending: 5 }, entityType: 'AuditAlert' })
      );
    });
  });

  describe('acknowledge', () => {
    it('lanza 404 si no marcó ninguna alerta', async () => {
      auditAlertRepo.acknowledge.mockResolvedValue(0);

      await expect(service.acknowledge('a-1', ADMIN)).rejects.toMatchObject({ statusCode: 404 });
      expect(auditAlertRepo.findById).not.toHaveBeenCalled();
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('marca, audita, notifica (setImmediate) y devuelve el registro DTO', async () => {
      auditAlertRepo.acknowledge.mockResolvedValue(1);
      auditAlertRepo.findById.mockResolvedValue({ audit_alert_id: 'a-1', acknowledged: true });

      const result = await service.acknowledge('a-1', ADMIN);

      expect(result).toMatchObject({ dto: true, audit_alert_id: 'a-1' });
      expect(logAudit).toHaveBeenCalledWith('AUDIT_ALERT_ACKNOWLEDGED', expect.objectContaining({ actorId: ADMIN, details: { alertId: 'a-1' }, entityId: 'a-1', entityType: 'AuditAlert' })
      );

      await flushMacrotasks();
      expect(notificationCreation.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'AUDIT_ALERT_ACKNOWLEDGED', userId: ADMIN })
      );
    });
  });

  describe('acknowledgeBulk', () => {
    it('reporta {acknowledged, requested} y audita el bulk', async () => {
      auditAlertRepo.acknowledgeBulk.mockResolvedValue(2);

      const result = await service.acknowledgeBulk(['a-1', 'a-2', 'a-3'], ADMIN);

      expect(result).toEqual({ acknowledged: 2, requested: 3 });
      expect(logAudit).toHaveBeenCalledWith('AUDIT_ALERTS_BULK_ACKNOWLEDGED', expect.objectContaining({ actorId: ADMIN, details: { requested: 3, acknowledged: 2 }, entityType: 'AuditAlert' })
      );

      await flushMacrotasks();
      expect(notificationCreation.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'AUDIT_ALERTS_BULK_ACKNOWLEDGED', userId: ADMIN })
      );
    });
  });
});
