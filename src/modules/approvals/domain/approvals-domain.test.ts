// Reglas del dominio approvals: las operaciones gateadas (condición, umbral, vencimiento, quién resuelve, quién se
// salta los cuatro ojos) y la solicitud (solo una pendiente se resuelve, el checker no es el maker).
import { approvalRequest, MAKER_ID } from '../../../../tests/doubles/approvals.doubles';
import { autoApprovedRequest, AUTO_APPROVE_NOTE, storableResult } from './approval-request';
import {
  assertCanResolve,
  expiresAtFor,
  findOperation,
  isSuperAdmin,
  operationOf,
  operations,
  requiresApproval,
  thresholdOf,
  ttlHoursOf,
  type DualApprovalOperation
} from './dual-approval-operation';
import { addBusinessHours } from './business-hours';

const RBAC = operationOf('RBAC_ROLE_CHANGE');
const threshold = (over: Partial<DualApprovalOperation> = {}): DualApprovalOperation => ({
  ...RBAC,
  condition: 'threshold',
  thresholdField: 'amount',
  thresholdDefault: 100,
  ...over
});

describe('operaciones gateadas', () => {
  it('se buscan por clave; una desconocida no existe y operationOf la rechaza con su código', () => {
    expect(findOperation('RBAC_ROLE_CHANGE')).toBe(RBAC);
    expect(findOperation('OP_X')).toBeUndefined();
    expect(() => operationOf('OP_X')).toThrow(expect.objectContaining({ kind: 'invalid_input', code: 'BAD_REQUEST', details: { code: 'UNKNOWN_DUAL_APPROVAL_OP' } }));
    expect(operations().map(([key]) => key)).toEqual(['RBAC_ROLE_CHANGE', 'CLIENT_ACCOUNT_DELETE', 'INTERNAL_USER_DELETE']);
  });

  it('ALWAYS siempre exige aprobación; THRESHOLD cuando el campo supera el umbral', () => {
    expect(requiresApproval(RBAC, {}, 0)).toBe(true);
    expect(requiresApproval(threshold(), { amount: 150 }, 100)).toBe(true);
    expect(requiresApproval(threshold(), { amount: 100 }, 100)).toBe(false);
    expect(requiresApproval(threshold(), null, 100)).toBe(false);
  });

  it('el umbral: el configurado si la operación declara clave y hay valor; si no, su default (o 0)', () => {
    expect(thresholdOf(threshold({ thresholdConfigKey: 'k' }), 500)).toBe(500);
    expect(thresholdOf(threshold({ thresholdConfigKey: 'k' }), null)).toBe(100);
    expect(thresholdOf(threshold(), 500)).toBe(100);
    expect(thresholdOf(threshold({ thresholdDefault: undefined }), null)).toBe(0);
  });

  it('vence a su TTL en horas hábiles (72 por defecto)', () => {
    const now = new Date(2026, 0, 5, 10);
    expect(ttlHoursOf(RBAC)).toBe(72);
    expect(ttlHoursOf({ ...RBAC, ttlHours: undefined })).toBe(72);
    expect(expiresAtFor({ ...RBAC, ttlHours: 5 }, now)).toEqual(addBusinessHours(now, 5));
  });

  it('super_admin omite los cuatro ojos; ADMIN y sin rol no', () => {
    expect(isSuperAdmin('SUPERADMIN')).toBe(true);
    expect(isSuperAdmin('ADMIN')).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
  });

  it('resuelve un rol aprobador o comodín; sin rol conocido no se bloquea', () => {
    expect(() => assertCanResolve(RBAC, 'ADMIN')).not.toThrow();
    expect(() => assertCanResolve(RBAC, 'SUPERADMIN')).not.toThrow();
    expect(() => assertCanResolve(RBAC, null)).not.toThrow();
    expect(() => assertCanResolve(RBAC, 'AUDITOR')).toThrow(expect.objectContaining({ kind: 'forbidden', details: { code: 'DUAL_APPROVAL_ROLE_NOT_ALLOWED' } }));
  });
});

describe('ApprovalRequest', () => {
  it('solo una pendiente se resuelve', () => {
    expect(() => approvalRequest().assertPending()).not.toThrow();
    expect(() => approvalRequest({ status: 'approved' }).assertPending()).toThrow(
      expect.objectContaining({
        kind: 'conflict',
        message: 'La solicitud ya está en estado "approved" y no puede re-resolverse',
        details: { code: 'APPROVAL_REQUEST_NOT_PENDING' }
      })
    );
  });

  it('segregación de funciones: el maker no la aprueba', () => {
    expect(() => approvalRequest().assertNotRequestedBy('otro')).not.toThrow();
    expect(() => approvalRequest().assertNotRequestedBy(MAKER_ID)).toThrow(expect.objectContaining({ kind: 'forbidden', details: { code: 'DUAL_APPROVAL_SAME_AS_MAKER' } }));
  });

  it('la de un super_admin nace aprobada por él mismo, sin vencimiento', () => {
    const now = new Date();
    expect(autoApprovedRequest({ operationKey: 'X', entityType: 'User', entityId: 'u', payload: {}, requestedBy: MAKER_ID }, now)).toEqual({
      operationKey: 'X',
      entityType: 'User',
      entityId: 'u',
      payload: {},
      requestedBy: MAKER_ID,
      requestedAt: now,
      status: 'approved',
      secondApproverId: MAKER_ID,
      resolvedAt: now,
      resolutionNotes: AUTO_APPROVE_NOTE,
      expiresAt: null
    });
  });

  it('el resultado que se guarda es serializable (o null)', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(storableResult({ at: new Date('2026-01-01T00:00:00Z'), fn: () => 1 })).toEqual({ at: '2026-01-01T00:00:00.000Z' });
    expect(storableResult(undefined)).toBeNull();
    expect(storableResult(cyclic)).toBeNull();
  });
});
