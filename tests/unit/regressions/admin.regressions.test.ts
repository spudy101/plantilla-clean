// Regresiones de bugs que destapó el tipado de modules/admin (fase 4 de la migración a TS).

import { fixture } from 'tests/helpers/mock';
import { ApprovalRequestMapper, type ApprovalRequestRecord } from '../../../src/modules/approvals/infrastructure/persistence/approval-request.mapper';
import { toApprovalRequestListItem, toApprovalRequestOutput } from '../../../src/modules/approvals/application/dto/approval-request.output';
import adminAuditContextUtilModule from '../../../src/shared/presentation/http/admin-audit-context.util';
const { adminAuditContext } = adminAuditContextUtilModule;

describe('Timestamps de modelos underscored', () => {
  // En una consulta normal Sequelize expone el atributo (createdAt), no la columna (created_at).
  // Estos DTOs leían created_at → la fecha salía siempre null/undefined.
  const createdAt = new Date('2026-01-02T03:04:05Z');
  const updatedAt = new Date('2026-01-03T03:04:05Z');

  it('la solicitud de aprobación devuelve createdAt/updatedAt del atributo', () => {
    const request = ApprovalRequestMapper.toDomain(fixture<ApprovalRequestRecord>({ approvalRequestId: 'ar-1', operationKey: 'X', status: 'pending', createdAt, updatedAt }));
    const dto = toApprovalRequestOutput(request);
    expect(dto.createdAt).toBe(createdAt);
    expect(dto.updatedAt).toBe(updatedAt);
    expect(toApprovalRequestListItem(request).createdAt).toBe(createdAt);
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
