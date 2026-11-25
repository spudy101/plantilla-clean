// Casos de uso de approvals con dobles en memoria de sus puertos (sin jest.mock): el gate, la resolución, las
// consultas del panel, las pendientes de otros módulos y el vencimiento.
import {
  approvalRequest,
  CHECKER_CTX,
  CHECKER_ID,
  FixedApprovers,
  InMemoryApprovalRequests,
  MAKER_CTX,
  MAKER_ID,
  noThresholds,
  REQUEST_ID
} from '../../../../../tests/doubles/approvals.doubles';
import { RecordingAuditTrail, RecordingNotifier, silentLogger } from '../../../../../tests/doubles/settings.doubles';
import { flushBackground } from '../../../../../tests/doubles/notification.doubles';
import { ApprovalHandlers } from './approval-handlers';
import { ApprovalNotices } from './approval-notices';
import { GateOperation } from './gate-operation.use-case';
import { ResolveApprovalRequest } from './resolve-approval-request.use-case';
import { GetApprovalPolicy, GetApprovalRequest, ListApprovalRequests } from './approval-request-queries.use-cases';
import { FindPendingApprovals } from './pending-approvals.use-case';
import { ExpireApprovalRequests } from './expire-approval-requests.use-case';

const LOGO = 'https://logo.test/x.png';

function setup(requests = new InMemoryApprovalRequests(), approvers = new FixedApprovers(['ap-1', 'ap-2'])) {
  const audit = new RecordingAuditTrail();
  const notifier = new RecordingNotifier();
  const logger = { ...silentLogger, warn: jest.fn(), error: jest.fn() };
  const notices = new ApprovalNotices(approvers, notifier, logger, LOGO);
  const handlers = new ApprovalHandlers();
  return {
    requests,
    approvers,
    audit,
    notifier,
    logger,
    handlers,
    gate: new GateOperation(requests, noThresholds, notices, audit, logger),
    resolve: new ResolveApprovalRequest(requests, handlers, notices, audit)
  };
}

const AUDIT_ENTITY = { entityType: 'ApprovalRequest', entityTable: 'approval_requests' };

describe('GateOperation', () => {
  it('abre la solicitud pendiente, avisa a los aprobadores y lo audita', async () => {
    const s = setup();
    const result = await s.gate.execute('RBAC_ROLE_CHANGE', { entityId: 'user-9', payload: { userId: 'user-9', roleId: 'r-2' }, ctx: MAKER_CTX });

    expect(result).toMatchObject({ pending: true, request: { approvalRequestId: 'ar-1', status: 'pending', requestedBy: null, entityType: 'User' } });
    expect(s.requests.created[0]).toMatchObject({ operationKey: 'RBAC_ROLE_CHANGE', entityType: 'User', entityId: 'user-9', requestedBy: MAKER_ID, status: 'pending' });
    expect(s.requests.created[0]!.expiresAt).toBeInstanceOf(Date);
    expect(s.audit.entries).toEqual([
      {
        action: 'DUAL_APPROVAL_REQUESTED',
        actorId: MAKER_ID,
        details: { approvalRequestId: 'ar-1', operationKey: 'RBAC_ROLE_CHANGE', entityType: 'User', entityId: 'user-9', expiresAt: s.requests.created[0]!.expiresAt },
        entityId: 'ar-1',
        ...AUDIT_ENTITY
      }
    ]);

    await flushBackground();
    expect(s.approvers.asked).toEqual([['ADMIN']]);
    expect(s.notifier.sent).toEqual(
      ['ap-1', 'ap-2'].map(userId => ({
        type: 'RBAC_SECOND_APPROVER',
        userId,
        relatedEntity: { type: 'ApprovalRequest', id: 'ar-1' },
        metadata: { approvalRequestId: 'ar-1', operationLabel: 'Cambio de rol de usuario', entityType: 'User', entityId: 'user-9', firstName: 'Ana', logoUrl: LOGO }
      }))
    );
  });

  it('super_admin: la crea ya aprobada por él mismo y la operación sigue (sin handler ni avisos)', async () => {
    const s = setup();
    const result = await s.gate.execute('INTERNAL_USER_DELETE', { entityType: 'User', entityId: 'u-1', payload: { userId: 'u-1' }, ctx: { ...MAKER_CTX, adminRoleName: 'SUPERADMIN' } });

    expect(result).toMatchObject({ pending: false, autoApproved: true, request: { status: 'approved', resolutionNotes: expect.stringContaining('super_admin') } });
    expect(s.requests.created[0]).toMatchObject({ status: 'approved', secondApproverId: MAKER_ID, expiresAt: null });
    expect(s.audit.entries.map(e => e.action)).toEqual(['DUAL_APPROVAL_REQUESTED', 'DUAL_APPROVAL_AUTO_APPROVED']);
    expect(s.audit.entries[1]!.details).toEqual({ approvalRequestId: 'ar-1', operationKey: 'INTERNAL_USER_DELETE', entityType: 'User', entityId: 'u-1' });
    await flushBackground();
    expect(s.notifier.sent).toEqual([]);
  });

  it('una sola pendiente por operación y entidad', async () => {
    const s = setup(new InMemoryApprovalRequests([approvalRequest()]));
    await expect(s.gate.execute('RBAC_ROLE_CHANGE', { entityId: 'user-9', ctx: MAKER_CTX })).rejects.toMatchObject({
      kind: 'conflict',
      code: 'CONFLICT',
      details: { code: 'DUAL_APPROVAL_ALREADY_PENDING', approvalRequestId: REQUEST_ID }
    });
    expect(s.requests.created).toEqual([]);
  });

  it('una operación desconocida no se gatea', async () => {
    await expect(setup().gate.execute('OP_X', { ctx: MAKER_CTX })).rejects.toMatchObject({ details: { code: 'UNKNOWN_DUAL_APPROVAL_OP' } });
  });

  it('si no se encuentran los aprobadores, se loguea y la solicitud igual queda', async () => {
    const s = setup(undefined, new FixedApprovers(new Error('BD caída')));
    await expect(s.gate.execute('RBAC_ROLE_CHANGE', { entityId: 'user-9', ctx: MAKER_CTX })).resolves.toMatchObject({ pending: true });
    await flushBackground();
    expect(s.logger.warn).toHaveBeenCalledWith('[DualApproval] Error buscando aprobadores', { error: 'BD caída', operationKey: 'RBAC_ROLE_CHANGE' });
  });
});

describe('ResolveApprovalRequest', () => {
  const resolveWith = (s: ReturnType<typeof setup>, decision: string, ctx = CHECKER_CTX, notes: string | null = 'ok') =>
    s.resolve.execute({ approvalRequestId: REQUEST_ID, decision, notes, ctx });

  it('aprobar: ejecuta la reanudación, guarda su resultado, avisa al maker y lo audita', async () => {
    const s = setup(new InMemoryApprovalRequests([approvalRequest()]));
    const onApprove = jest.fn().mockResolvedValue({ changed: true, at: new Date('2026-01-01T00:00:00Z') });
    s.handlers.register('RBAC_ROLE_CHANGE', onApprove);

    const output = await resolveWith(s, 'approve');

    expect(onApprove).toHaveBeenCalledWith({ userId: 'user-9', roleId: 'role-2' }, CHECKER_CTX);
    expect(s.requests.resolutions[0]).toEqual({
      approvalRequestId: REQUEST_ID,
      resolution: { status: 'approved', secondApproverId: CHECKER_ID, resolvedAt: expect.any(Date), resolutionNotes: 'ok', result: { changed: true, at: '2026-01-01T00:00:00.000Z' } }
    });
    expect(output).toMatchObject({ status: 'approved', result: { changed: true } });
    expect(s.audit.entries).toEqual([
      {
        action: 'DUAL_APPROVAL_APPROVED',
        actorId: CHECKER_ID,
        details: { approvalRequestId: REQUEST_ID, operationKey: 'RBAC_ROLE_CHANGE', entityType: 'User', entityId: 'user-9' },
        entityId: REQUEST_ID,
        ...AUDIT_ENTITY
      }
    ]);
    await flushBackground();
    expect(s.notifier.sent).toEqual([
      {
        type: 'DUAL_APPROVAL_RESOLVED',
        userId: MAKER_ID,
        relatedEntity: { type: 'ApprovalRequest', id: REQUEST_ID },
        metadata: { approvalRequestId: REQUEST_ID, operationLabel: 'Cambio de rol de usuario', decision: 'approve', logoUrl: LOGO }
      }
    ]);
  });

  it('rechazar: la reacción opcional y el cierre, sin resultado', async () => {
    const s = setup(new InMemoryApprovalRequests([approvalRequest()]));
    const onReject = jest.fn().mockResolvedValue(undefined);
    s.handlers.register('RBAC_ROLE_CHANGE', jest.fn(), onReject);

    await resolveWith(s, 'reject', CHECKER_CTX, null);

    expect(onReject).toHaveBeenCalledWith({ userId: 'user-9', roleId: 'role-2' }, CHECKER_CTX);
    expect(s.requests.resolutions[0]!.resolution).toEqual({ status: 'rejected', secondApproverId: CHECKER_ID, resolvedAt: expect.any(Date), resolutionNotes: null });
    expect(s.audit.entries.map(e => e.action)).toEqual(['DUAL_APPROVAL_REJECTED']);
  });

  it('rechazar sin reacción registrada solo cierra', async () => {
    const s = setup(new InMemoryApprovalRequests([approvalRequest()]));
    await expect(resolveWith(s, 'reject')).resolves.toMatchObject({ status: 'rejected' });
  });

  it.each([
    ['no existe', [], CHECKER_CTX, 'approve', { kind: 'not_found', details: { code: 'APPROVAL_REQUEST_NOT_FOUND' } }],
    ['ya no está pendiente', [approvalRequest({ status: 'expired' })], CHECKER_CTX, 'approve', { kind: 'conflict', details: { code: 'APPROVAL_REQUEST_NOT_PENDING' } }],
    ['operación desconocida', [approvalRequest({ operationKey: 'OP_X' })], CHECKER_CTX, 'approve', { details: { code: 'UNKNOWN_DUAL_APPROVAL_OP' } }],
    ['rol no aprobador', [approvalRequest()], { ...CHECKER_CTX, adminRoleName: 'AUDITOR' }, 'approve', { details: { code: 'DUAL_APPROVAL_ROLE_NOT_ALLOWED' } }],
    ['el checker es el maker', [approvalRequest()], MAKER_CTX, 'approve', { details: { code: 'DUAL_APPROVAL_SAME_AS_MAKER' } }],
    ['decisión no reconocida', [approvalRequest()], CHECKER_CTX, 'quizas', { details: { code: 'INVALID_RESOLUTION_DECISION' } }],
    ['sin reanudación registrada', [approvalRequest()], CHECKER_CTX, 'approve', { code: 'BAD_REQUEST', details: { code: 'DUAL_APPROVAL_NO_HANDLER' } }]
  ])('rechaza cuando %s', async (_case, rows, ctx, decision, error) => {
    const s = setup(new InMemoryApprovalRequests(rows));
    await expect(resolveWith(s, decision, ctx)).rejects.toMatchObject(error);
    expect(s.requests.resolutions).toEqual([]);
    expect(s.audit.entries).toEqual([]);
  });

  it('si la solicitud desaparece al cerrarla: 404 sin código de detalle', async () => {
    const requests = new InMemoryApprovalRequests([approvalRequest()]);
    requests.resolveFinds = false;
    const s = setup(requests);
    s.handlers.register('RBAC_ROLE_CHANGE', async () => null);
    await expect(resolveWith(s, 'approve')).rejects.toMatchObject({ kind: 'not_found', details: null });
  });
});

describe('ApprovalHandlers', () => {
  it('solo registra operaciones conocidas y funciones', () => {
    const handlers = new ApprovalHandlers();
    expect(() => handlers.register('OP_X', async () => null)).toThrow(/desconocida/);
    expect(() => handlers.register('RBAC_ROLE_CHANGE', 'x' as never)).toThrow(/Handler inválido/);
    expect(() => handlers.register('RBAC_ROLE_CHANGE', async () => null, 'x' as never)).toThrow(/onReject inválido/);
    handlers.register('RBAC_ROLE_CHANGE', async () => null);
    expect(handlers.find('RBAC_ROLE_CHANGE')).toMatchObject({ onReject: null });
  });
});

describe('consultas del panel', () => {
  it('ListApprovalRequests: la página sin payload ni result, con los filtros, y lo audita', async () => {
    const requests = new InMemoryApprovalRequests([approvalRequest()]);
    const audit = new RecordingAuditTrail();
    const result = await new ListApprovalRequests(requests, audit).execute({
      actorId: CHECKER_ID,
      query: { page: 1, limit: 10, sortBy: 'createdAt', order: 'DESC', status: 'pending', search: 'rbac' }
    });

    expect(requests.listCalls[0]).toMatchObject({ filters: { operationKey: undefined, status: 'pending', entityType: undefined }, search: 'rbac' });
    expect(result.data[0]).not.toHaveProperty('payload');
    expect(result.data[0]).toMatchObject({ approvalRequestId: REQUEST_ID, requestedBy: { username: 'ana' } });
    expect(result.metadata).toMatchObject({ pagination: { totalItems: 1 }, filters: { status: 'pending', search: 'rbac' } });
    expect(audit.entries).toEqual([
      { action: 'APPROVAL_REQUEST_LIST_VIEWED', actorId: CHECKER_ID, details: { operationKey: null, status: 'pending' }, ...AUDIT_ENTITY }
    ]);
  });

  it('GetApprovalRequest: el detalle auditado; 404 si no existe', async () => {
    const audit = new RecordingAuditTrail();
    const get = new GetApprovalRequest(new InMemoryApprovalRequests([approvalRequest()]), audit);
    await expect(get.execute({ actorId: CHECKER_ID, approvalRequestId: REQUEST_ID })).resolves.toMatchObject({ payload: { roleId: 'role-2' } });
    expect(audit.entries).toEqual([{ action: 'APPROVAL_REQUEST_VIEWED', actorId: CHECKER_ID, entityId: REQUEST_ID, ...AUDIT_ENTITY }]);
    await expect(get.execute({ actorId: CHECKER_ID, approvalRequestId: 'x' })).rejects.toMatchObject({ details: { code: 'APPROVAL_REQUEST_NOT_FOUND' } });
  });

  it('GetApprovalPolicy: cada operación con su condición y TTL, siempre activa', async () => {
    const audit = new RecordingAuditTrail();
    const policy = await new GetApprovalPolicy(noThresholds, audit, silentLogger).execute({ actorId: CHECKER_ID });
    expect(policy.enabled).toBe(true);
    expect(policy.operations[0]).toEqual({
      operationKey: 'RBAC_ROLE_CHANGE',
      label: 'Cambio de rol de usuario',
      condition: 'always',
      approverRoles: ['ADMIN'],
      entityType: 'User',
      ttlHours: 72
    });
    expect(audit.entries).toEqual([{ action: 'APPROVAL_POLICY_VIEWED', actorId: CHECKER_ID, ...AUDIT_ENTITY }]);
  });
});

describe('FindPendingApprovals', () => {
  it('la pendiente de cada entidad, en una sola consulta; sin ids no consulta', async () => {
    const requests = new InMemoryApprovalRequests([approvalRequest()]);
    const find = new FindPendingApprovals(requests);
    const pending = await find.execute('User', ['user-9', 'user-10']);
    expect([...pending.keys()]).toEqual(['user-9']);
    expect(pending.get('user-9')).toEqual({
      approvalRequestId: REQUEST_ID,
      operationKey: 'RBAC_ROLE_CHANGE',
      status: 'pending',
      requestedBy: { userId: MAKER_ID, username: 'ana', firstName: 'Ana', lastName: 'Pérez' },
      requestedAt: expect.any(Date),
      expiresAt: expect.any(Date)
    });
    await find.execute('User', []);
    expect(requests.pendingLookups).toHaveLength(1);
  });
});

describe('ExpireApprovalRequests', () => {
  it('vence y audita las pendientes vencidas; saltea las ya resueltas y sigue si una falla', async () => {
    const past = new Date('2020-01-01T00:00:00Z');
    const requests = new InMemoryApprovalRequests([
      approvalRequest({ approvalRequestId: 'r-1', expiresAt: past }),
      approvalRequest({ approvalRequestId: 'r-2', expiresAt: past }),
      approvalRequest({ approvalRequestId: 'r-3', expiresAt: past }),
      approvalRequest({ approvalRequestId: 'r-4', expiresAt: null })
    ]);
    requests.alreadyResolved.add('r-2');
    requests.failMarkExpired.add('r-3');
    const audit = new RecordingAuditTrail();
    const logger = { ...silentLogger, error: jest.fn() };

    await expect(new ExpireApprovalRequests(requests, audit, logger).execute(new Date())).resolves.toEqual({ expired: 1 });
    expect(audit.entries).toEqual([
      {
        action: 'DUAL_APPROVAL_EXPIRED',
        actorId: 'system',
        details: { approvalRequestId: 'r-1', operationKey: 'RBAC_ROLE_CHANGE', entityType: 'User', entityId: 'user-9', expiresAt: past },
        entityId: 'r-1',
        ...AUDIT_ENTITY
      }
    ]);
    expect(logger.error).toHaveBeenCalledWith('Error al expirar solicitud de doble aprobación', { approvalRequestId: 'r-3', error: 'BD caída' });
  });
});
