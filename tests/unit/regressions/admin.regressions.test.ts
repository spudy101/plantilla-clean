// tests/unit/modules/admin/admin.regressions.test.ts
//
// Regresiones de bugs que destapó el tipado de modules/admin (fase 4 de la migración a TS).

import { fixture } from 'tests/helpers/mock';
import componentsApprovalDtoModule from '../../../src/modules/approvals/responses/approval-components.response';
const { ApprovalRequestComponent } = componentsApprovalDtoModule;
import adminAuditContextUtilModule from '../../../src/shared/presentation/http/admin-audit-context.util';
const { adminAuditContext } = adminAuditContextUtilModule;

describe('Timestamps de modelos underscored', () => {
  // En una consulta normal Sequelize expone el atributo (createdAt), no la columna (created_at).
  // Estos DTOs leían created_at → la fecha salía siempre null/undefined.
  const createdAt = new Date('2026-01-02T03:04:05Z');
  const updatedAt = new Date('2026-01-03T03:04:05Z');

  it('ApprovalRequestComponent devuelve createdAt/updatedAt del atributo', () => {
    const dto = ApprovalRequestComponent.build({ approvalRequestId: 'ar-1', operationKey: 'X', status: 'pending', createdAt, updatedAt });
    expect(dto?.createdAt).toBe(createdAt);
    expect(dto?.updatedAt).toBe(updatedAt);
    expect(ApprovalRequestComponent.buildList({ approvalRequestId: 'ar-1', operationKey: 'X', status: 'pending', createdAt })?.createdAt).toBe(createdAt);
  });
});

describe('adminAuditContext', () => {
  // Reemplaza 6 copias locales (_auditCtx / _approverCtx) que variaban entre controllers.
  it('arma el contexto completo desde el usuario autenticado y el contexto HTTP', () => {
    const req = { user: { userId: 'a-1', roleName: 'ADMIN', firstName: 'Ana' } };
    const res = { locals: { auditContext: { ip: '10.0.0.1', userAgent: 'jest' } } };
    expect(adminAuditContext(fixture(req), fixture(res))).toEqual({
      adminUserId: 'a-1',
      adminRoleName: 'ADMIN',
      adminFirstName: 'Ana',
      ipAddress: '10.0.0.1',
      userAgent: 'jest'
    });
  });

  it('responde 401 si la ruta quedó sin autenticación', () => {
    expect(() => adminAuditContext(fixture({}), fixture({ locals: {} }))).toThrow(expect.objectContaining({ statusCode: 401 }));
  });
});
