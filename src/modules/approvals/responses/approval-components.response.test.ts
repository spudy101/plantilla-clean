// La salida de cada constructor de approvals cumple su esquema (y por lo tanto su documentación).
import components, { ApprovalRequestListItemSchema, ApprovalRequestSchema, PendingApprovalSchema } from './approval-components.response';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const at = new Date('2026-01-01T00:00:00Z');
const user = { userId: ID, username: 'ana', person: { firstName: 'Ana', lastName: 'Pérez' } };
const request = {
  approvalRequestId: ID,
  operationKey: 'RBAC_ROLE_CHANGE',
  entityType: 'User',
  entityId: ID,
  status: 'approved',
  requester: user,
  requestedAt: at,
  secondApprover: user,
  resolvedAt: at,
  resolutionNotes: 'ok',
  expiresAt: at,
  payload: { roleId: ID },
  result: { ok: true },
  originSessionId: ID,
  createdAt: at,
  updatedAt: at
};

const ok = (schema: { safeParse(v: unknown): { error?: { issues: unknown[] } } }, value: unknown) =>
  expect(schema.safeParse(value).error?.issues ?? []).toEqual([]);

describe('esquemas de salida de approvals', () => {
  it('solicitud: detalle, ítem de lista y pendiente', () => {
    ok(ApprovalRequestSchema, components.ApprovalRequestComponent.build(request));
    ok(ApprovalRequestListItemSchema, components.ApprovalRequestComponent.buildList(request));
    ok(PendingApprovalSchema, components.PendingApprovalComponent.build(request));
    ok(PendingApprovalSchema, components.PendingApprovalComponent.build(null));
  });
});
