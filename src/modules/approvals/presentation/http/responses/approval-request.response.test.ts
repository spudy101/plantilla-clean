// La salida de cada constructor de approvals (application/dto) cumple su esquema (y por lo tanto su documentación).
import { ApprovalPolicySchema, ApprovalRequestListItemSchema, ApprovalRequestSchema, PendingApprovalSchema } from './approval-request.response';
import { toApprovalRequestListItem, toApprovalRequestOutput, toPendingApprovalOutput } from '../../../application/dto/approval-request.output';
import { ApprovalRequest } from '../../../domain/approval-request';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const at = new Date('2026-01-01T00:00:00Z');
const user = { userId: ID, username: 'ana', firstName: 'Ana', lastName: 'Pérez' };
const request = ApprovalRequest.restore({
  approvalRequestId: ID,
  operationKey: 'RBAC_ROLE_CHANGE',
  entityType: 'User',
  entityId: ID,
  status: 'approved',
  requestedBy: ID,
  requester: user,
  requestedAt: at,
  secondApproverId: ID,
  secondApprover: user,
  resolvedAt: at,
  resolutionNotes: 'ok',
  expiresAt: at,
  payload: { roleId: ID },
  result: { ok: true },
  originSessionId: ID,
  createdAt: at,
  updatedAt: at
});

const ok = (schema: { safeParse(v: unknown): { error?: { issues: unknown[] } } }, value: unknown) =>
  expect(schema.safeParse(value).error?.issues ?? []).toEqual([]);

describe('esquemas de salida de approvals', () => {
  it('solicitud: detalle, ítem de lista y pendiente', () => {
    ok(ApprovalRequestSchema, toApprovalRequestOutput(request));
    ok(ApprovalRequestListItemSchema, toApprovalRequestListItem(request));
    ok(PendingApprovalSchema, toPendingApprovalOutput(request));
    ok(PendingApprovalSchema, null);
  });

  it('la solicitud recién creada (sin sus usuarios) también', () => {
    const created = ApprovalRequest.restore({
      ...toApprovalRequestOutput(request),
      status: 'pending',
      requestedBy: ID,
      requester: null,
      secondApproverId: null,
      secondApprover: null,
      resolvedAt: null,
      result: null
    });
    ok(ApprovalRequestSchema, toApprovalRequestOutput(created));
  });

  it('política', () => {
    ok(ApprovalPolicySchema, {
      enabled: true,
      operations: [{ operationKey: 'RBAC_ROLE_CHANGE', label: 'x', condition: 'always', approverRoles: ['ADMIN'], entityType: 'User', ttlHours: 72 }]
    });
  });
});
