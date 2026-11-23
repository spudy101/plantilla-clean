// tests/unit/core/dual-approval.service.test.ts
//
// DualApprovalService — núcleo del maker-checker (cuatro ojos). Probamos la lógica de decisión:
// registro de handlers (IoC), condición de gate, bypass de super_admin, y las guardas de
// resolve() (existe / pendiente / segregación de funciones / rol autorizado), más el camino
// feliz de aprobación (invoca el handler registrado). Mockeamos repos, notificaciones, logger y
// el DTO de salida para aislar la lógica del acceso a datos.

jest.mock('../repositories/approval-request.repository', () => ({
  create: jest.fn(),
  findByIdWithUsers: jest.fn(),
  resolve: jest.fn(),
  findPendingByEntityOperation: jest.fn(),
  findPendingByEntityIds: jest.fn()
}));

jest.mock('../../iam/repositories/user.repository', () => ({
  findActiveUsersByRoleNames: jest.fn().mockResolvedValue([])
}));

jest.mock('../../notification/services/notification-creation.service', () => ({
  crearNotificacion: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() }
}));
jest.mock('../../audit/infrastructure/legacy/audit-recorder', () => ({ record: jest.fn() }));

// El DTO de salida se reduce a identidad para no depender de su forma interna.
jest.mock('../responses/approval-components.response', () => ({
  ApprovalRequestComponent: { build: (x: Loose) => x, buildList: (x: Loose) => x },
  PendingApprovalComponent: { build: (x: Loose) => x }
}));

import { mocked, Loose, fixture } from 'tests/helpers/mock';
import approvalRepoModule from '../repositories/approval-request.repository';
const approvalRepo = mocked(approvalRepoModule);
import dualApproval from './dual-approval.service';
import domainEnumsModule from '../../../shared/infrastructure/database/domain-enums';
const { APPROVAL_REQUEST_STATUS } = domainEnumsModule;

const OP = 'RBAC_ROLE_CHANGE'; // condición ALWAYS, approverRoles: ['ADMIN']

function pendingRequest(overrides = {}) {
  return {
    approvalRequestId: 'req-1',
    operationKey: OP,
    entityType: 'User',
    entityId: 'user-9',
    payload: { roleName: 'ADMIN' },
    requestedBy: 'maker-1',
    status: APPROVAL_REQUEST_STATUS.PENDING,
    ...overrides
  };
}

describe('DualApprovalService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('lanza ante una operación desconocida', () => {
      expect(() => dualApproval.register('OP_INEXISTENTE', fixture(() => {}))).toThrow(/desconocida/i);
    });

    it('lanza si onApprove no es función', () => {
      expect(() => dualApproval.register(OP, fixture('no-soy-funcion'))).toThrow(/Handler inválido/i);
    });

    it('lanza si onReject se pasa y no es función', () => {
      expect(() => dualApproval.register(OP, fixture(() => {}), fixture('no-soy-funcion'))).toThrow(/onReject inválido/i);
    });

    it('registra un handler válido sin lanzar', () => {
      expect(() => dualApproval.register(OP, fixture(() => {}))).not.toThrow();
    });
  });

  describe('isSuperAdmin', () => {
    it('reconoce SUPERADMIN', () => {
      expect(dualApproval.isSuperAdmin('SUPERADMIN')).toBe(true);
    });

    it('no considera super a ADMIN ni a null', () => {
      expect(dualApproval.isSuperAdmin('ADMIN')).toBe(false);
      expect(dualApproval.isSuperAdmin(null)).toBe(false);
    });
  });

  describe('requiresApproval', () => {
    it('una operación ALWAYS siempre exige aprobación', async () => {
      await expect(dualApproval.requiresApproval(OP, {})).resolves.toBe(true);
    });

    it('lanza ante una operación desconocida', async () => {
      await expect(dualApproval.requiresApproval('OP_X', {})).rejects.toMatchObject({ details: { code: 'UNKNOWN_DUAL_APPROVAL_OP' } });
    });
  });

  describe('resolve — guardas', () => {
    it('lanza notFound si la solicitud no existe', async () => {
      approvalRepo.findByIdWithUsers.mockResolvedValue(null);
      await expect(dualApproval.resolve('req-x', { decision: 'approve' }, { adminUserId: 'u2' })).rejects.toMatchObject({
        statusCode: 404,
        details: { code: 'APPROVAL_REQUEST_NOT_FOUND' }
      });
    });

    it('lanza conflict si la solicitud ya no está pendiente', async () => {
      approvalRepo.findByIdWithUsers.mockResolvedValue(pendingRequest({ status: APPROVAL_REQUEST_STATUS.APPROVED }));
      await expect(dualApproval.resolve('req-1', { decision: 'approve' }, { adminUserId: 'u2', adminRoleName: 'ADMIN' })).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'APPROVAL_REQUEST_NOT_PENDING' }
      });
    });

    it('lanza forbidden si el rol del aprobador no está autorizado', async () => {
      approvalRepo.findByIdWithUsers.mockResolvedValue(pendingRequest());
      await expect(
        dualApproval.resolve('req-1', { decision: 'approve' }, { adminUserId: 'otro', adminRoleName: 'AUDITOR' })
      ).rejects.toMatchObject({ statusCode: 403, details: { code: 'DUAL_APPROVAL_ROLE_NOT_ALLOWED' } });
    });

    it('lanza forbidden si el aprobador es el mismo maker (segregación de funciones)', async () => {
      approvalRepo.findByIdWithUsers.mockResolvedValue(pendingRequest({ requestedBy: 'maker-1' }));
      await expect(
        dualApproval.resolve('req-1', { decision: 'approve' }, { adminUserId: 'maker-1', adminRoleName: 'ADMIN' })
      ).rejects.toMatchObject({ statusCode: 403, details: { code: 'DUAL_APPROVAL_SAME_AS_MAKER' } });
    });

    it('rechaza una decisión no reconocida', async () => {
      approvalRepo.findByIdWithUsers.mockResolvedValue(pendingRequest());
      await expect(
        dualApproval.resolve('req-1', { decision: 'quizas' }, { adminUserId: 'otro', adminRoleName: 'ADMIN' })
      ).rejects.toMatchObject({ details: { code: 'INVALID_RESOLUTION_DECISION' } });
    });
  });

  describe('resolve — aprobación (camino feliz)', () => {
    it('invoca el handler registrado y marca la solicitud como APPROVED', async () => {
      const onApprove = jest.fn().mockResolvedValue({ ok: true });
      dualApproval.register(OP, onApprove);

      const request = pendingRequest();
      approvalRepo.findByIdWithUsers.mockResolvedValue(request);
      approvalRepo.resolve.mockResolvedValue({ ...request, status: APPROVAL_REQUEST_STATUS.APPROVED });

      await dualApproval.resolve('req-1', { decision: 'approve', notes: 'ok' }, { adminUserId: 'approver-2', adminRoleName: 'ADMIN' });

      expect(onApprove).toHaveBeenCalledWith(request.payload, expect.objectContaining({ adminUserId: 'approver-2' }));
      expect(approvalRepo.resolve).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          status: APPROVAL_REQUEST_STATUS.APPROVED,
          secondApproverId: 'approver-2'
        })
      );
    });

    it('lanza si no hay handler registrado para la operación', async () => {
      // CLIENT_ACCOUNT_DELETE nunca se registra en esta suite.
      const request = pendingRequest({ operationKey: 'CLIENT_ACCOUNT_DELETE' });
      approvalRepo.findByIdWithUsers.mockResolvedValue(request);

      await expect(
        dualApproval.resolve('req-1', { decision: 'approve' }, { adminUserId: 'approver-2', adminRoleName: 'ADMIN' })
      ).rejects.toMatchObject({ details: { code: 'DUAL_APPROVAL_NO_HANDLER' } });
    });
  });

  describe('resolve — rechazo', () => {
    it('marca la solicitud como REJECTED', async () => {
      const request = pendingRequest();
      approvalRepo.findByIdWithUsers.mockResolvedValue(request);
      approvalRepo.resolve.mockResolvedValue({ ...request, status: APPROVAL_REQUEST_STATUS.REJECTED });

      await dualApproval.resolve('req-1', { decision: 'reject', notes: 'no' }, { adminUserId: 'approver-2', adminRoleName: 'ADMIN' });

      expect(approvalRepo.resolve).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          status: APPROVAL_REQUEST_STATUS.REJECTED,
          secondApproverId: 'approver-2'
        })
      );
    });
  });

  describe('annotatePending', () => {
    it('anota filas planas (Prisma) por el campo indicado: la pendiente en la suya, null en el resto', async () => {
      approvalRepo.findPendingByEntityIds.mockResolvedValue([pendingRequest({ entityId: 'user-9' })]);
      const rows: Array<{ userId: string; pendingApproval?: unknown }> = [{ userId: 'user-9' }, { userId: 'user-10' }];

      await dualApproval.annotatePending('User', rows, 'userId');

      expect(approvalRepo.findPendingByEntityIds).toHaveBeenCalledWith('User', ['user-9', 'user-10']);
      expect(rows[0]!.pendingApproval).toEqual(expect.objectContaining({ approvalRequestId: 'req-1' }));
      expect(rows[1]!.pendingApproval).toBeNull();
    });
  });
});
