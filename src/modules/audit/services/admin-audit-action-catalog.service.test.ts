// tests/unit/modules/admin/records/audit/services/admin-audit-action-catalog.service.test.ts
//
// AdminAuditActionCatalogService — catálogo en memoria de acciones de auditoría (sin tabla). Con un
// catálogo mockeado y determinista probamos: getCategories() cuenta por categoría y ordena por es;
// getRisks() respeta AUDIT_RISK_ORDER; getModules() cuenta por módulo; listActions() filtra
// (category/risk/module/search), ordena ASC/DESC y pagina. El logger se mockea; los DTOs
// del catálogo (funciones puras) se usan reales.

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../audit.service', () => ({ record: jest.fn() }));

// Catálogo determinista: 3 acciones repartidas entre 3 categorías, 3 módulos y 3 riesgos.
jest.mock('../catalog', () => ({
  AUDIT_ACTIONS: {
    USER_LOGIN: { description: 'Inicio de sesión', category: 'SEGURIDAD', risk: 'LOW', module: 'IAM' },
    USER_DELETED: { description: 'Usuario eliminado', category: 'ADMINISTRACION', risk: 'HIGH', module: 'IAM' },
    PROFILE_VIEWED: { description: 'Perfil consultado', category: 'DATOS', risk: 'LOW', module: 'PERFIL' }
  },
  AUDIT_CATEGORIES: { SEGURIDAD: 'SEGURIDAD', ADMINISTRACION: 'ADMINISTRACION', DATOS: 'DATOS' },
  AUDIT_RISK_ORDER: ['LOW', 'MEDIUM', 'HIGH'],
  AUDIT_MODULES: { IAM: 'IAM', PERFIL: 'PERFIL' }
}));

import { mocked, Loose } from 'tests/helpers/mock';
import type { AuditActionListQuery } from '../requests/audit.request';
import auditServiceModule from '../audit.service';
const logAudit = mocked(auditServiceModule).record;
import service from './admin-audit-action-catalog.service';

const ADMIN = 'admin-1';
/** La query como la deja validate() (AuditActionListQuery): por action ASC, página 1 de 10. */
const q = (overrides: Loose = {}) => ({ page: 1, limit: 10, sortBy: 'action', order: 'ASC', ...overrides }) as AuditActionListQuery;

describe('AdminAuditActionCatalogService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCategories', () => {
    it('cuenta por categoría, ordena por localeCompare(es) y audita', () => {
      const { data } = service.getCategories(ADMIN);

      // Orden alfabético español: ADMINISTRACION, DATOS, SEGURIDAD
      expect(data.map(d => d.category)).toEqual(['ADMINISTRACION', 'DATOS', 'SEGURIDAD']);
      expect(data.every(d => d.actionsCount === 1)).toBe(true);
      expect(logAudit).toHaveBeenCalledWith('AUDIT_ACTION_CATALOG_CATEGORIES_VIEWED', expect.objectContaining({ actorId: ADMIN, details: { totalCategories: 3 }, entityType: 'AuditActionCatalog' })
      );
    });
  });

  describe('getRisks', () => {
    it('respeta AUDIT_RISK_ORDER y cuenta (LOW=2, MEDIUM=0, HIGH=1)', () => {
      const { data } = service.getRisks(ADMIN);

      expect(data.map(d => d.risk)).toEqual(['LOW', 'MEDIUM', 'HIGH']);
      expect(data.map(d => d.actionsCount)).toEqual([2, 0, 1]);
      expect(logAudit).toHaveBeenCalledWith('AUDIT_ACTION_CATALOG_RISKS_VIEWED', expect.objectContaining({ actorId: ADMIN, details: { totalRisks: 3 } })
      );
    });
  });

  describe('getModules', () => {
    it('cuenta por módulo (IAM=2, PERFIL=1)', () => {
      const { data } = service.getModules(ADMIN);

      const byModule = Object.fromEntries(data.map(d => [d.module, d.actionsCount]));
      expect(byModule).toEqual({ IAM: 2, PERFIL: 1 });
      expect(logAudit).toHaveBeenCalledWith('AUDIT_ACTION_CATALOG_MODULES_VIEWED', expect.objectContaining({ actorId: ADMIN, details: { totalModules: 2 } })
      );
    });
  });

  describe('listActions', () => {
    it('sin filtros devuelve todas ordenadas ASC por action', () => {
      const result = service.listActions(q(), ADMIN);

      expect(result.data.map(a => a.action)).toEqual(['PROFILE_VIEWED', 'USER_DELETED', 'USER_LOGIN']);
      expect(result.data[0]).toMatchObject({ action: 'PROFILE_VIEWED', module: 'PERFIL', risk: 'LOW' });
      expect(result.metadata).toMatchObject({ pagination: { totalItems: 3 }, sort: { field: 'action', order: 'ASC' } });
      expect(result.metadata.filters).toBeUndefined();
      expect(logAudit).toHaveBeenCalledWith('AUDIT_ACTION_CATALOG_ACTIONS_LISTED', expect.objectContaining({ actorId: ADMIN, details: { totalItems: 3, filters: [] } })
      );
    });

    it('ordena DESC cuando order=DESC', () => {
      const result = service.listActions(q({ order: 'DESC' }), ADMIN);

      expect(result.data.map(a => a.action)).toEqual(['USER_LOGIN', 'USER_DELETED', 'PROFILE_VIEWED']);
    });

    it('filtra por module', () => {
      const result = service.listActions(q({ module: 'IAM' }), ADMIN);

      expect(result.data.map(a => a.action)).toEqual(['USER_DELETED', 'USER_LOGIN']);
      expect(result.metadata.pagination.totalItems).toBe(2);
    });

    it('filtra por risk', () => {
      const result = service.listActions(q({ risk: 'LOW' }), ADMIN);

      expect(result.data.map(a => a.action)).toEqual(['PROFILE_VIEWED', 'USER_LOGIN']);
    });

    it('filtra por category', () => {
      const result = service.listActions(q({ category: 'DATOS' }), ADMIN);

      expect(result.data.map(a => a.action)).toEqual(['PROFILE_VIEWED']);
    });

    it('busca por texto en action o description (case-insensitive, trim)', () => {
      const result = service.listActions(q({ search: '  eliminado ' }), ADMIN);

      expect(result.data.map(a => a.action)).toEqual(['USER_DELETED']);
    });

    it('pagina: limit 1 offset 1 devuelve el segundo elemento del orden ASC', () => {
      const result = service.listActions(q({ page: 2, limit: 1 }), ADMIN);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.action).toBe('USER_DELETED');
      expect(result.metadata.pagination).toMatchObject({ totalItems: 3, pageSize: 1, currentPage: 2, totalPages: 3, hasNextPage: true, hasPreviousPage: true });
    });

    it('refleja los filtros activos en metadata y auditoría', () => {
      const result = service.listActions(q({ module: 'IAM' }), ADMIN);

      expect(result.metadata.filters).toEqual({ module: 'IAM' });
      expect(logAudit).toHaveBeenCalledWith('AUDIT_ACTION_CATALOG_ACTIONS_LISTED', expect.objectContaining({ actorId: ADMIN, details: expect.objectContaining({ filters: ['module'] }) })
      );
      expect(result.data.map(a => a.action)).toEqual(['USER_DELETED', 'USER_LOGIN']);
    });
  });
});
