// La salida de cada constructor de audit cumple su esquema (y por lo tanto su documentación).
import { pageMetadata } from '../../../shared/application/pagination';
import components, { AuditAlertSchema, AuditLogDetailSchema, AuditLogSchema } from './audit-components.response';
import catalogDto, {
  AuditActionCatalogItemSchema,
  AuditActionCategorySchema,
  AuditActionModuleSchema,
  AuditActionRiskSchema
} from './admin-audit-action-catalog.response';
import operationDto, { OperationSchema, OperationTimelineSchema } from './admin-operation.response';
import sessionDto, {
  SessionEntitiesSchema,
  SessionTimelineEventSchema,
  SessionTraceListItemSchema
} from './admin-session-trace.response';
import activityDto, { UserActivityItemSchema } from './user-activity.response';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const at = new Date('2026-01-01T00:00:00Z');
const user = { userId: ID, username: 'ana', person: { firstName: 'Ana', lastName: 'Pérez' } };
const log = {
  auditLogId: ID,
  action: 'PERSON_LIST_VIEWED',
  description: 'Listado consultado',
  category: 'Personas',
  module: 'admin',
  risk: 'medium',
  outcome: 'success',
  userId: ID,
  sessionId: ID,
  executor: user,
  entityId: ID,
  entityType: 'Person',
  entityTable: 'persons',
  ip: '1.1.1.1',
  source: 'http',
  correlationId: ID,
  userAgent: 'jest',
  fingerprint: null,
  details: { before: { email: 'a@b.co' }, after: { email: 'c@d.co' } },
  createdAt: at
};
const alert = {
  auditAlertId: ID,
  auditLogId: ID,
  action: 'RBAC_PERMISSION_GRANTED',
  category: 'RBAC',
  risk: 'high',
  userId: ID,
  actor: user,
  entityId: ID,
  entityType: 'Role',
  message: 'Permiso otorgado',
  acknowledged: true,
  acknowledgedBy: ID,
  acknowledgedByUser: user,
  acknowledgedAt: at,
  createdAt: at
};
const operation = {
  operationId: ID,
  parentId: null,
  clientRequestId: 'abc',
  source: 'http',
  name: 'GET /x',
  status: 'success',
  httpStatus: 200,
  errorCode: null,
  errorMessage: null,
  userId: ID,
  sessionId: ID,
  ip: '1.1.1.1',
  startedAt: at,
  endedAt: at,
  durationMs: 12
};
const session = {
  userSessionId: ID,
  userId: ID,
  status: 'active',
  ipAddress: '1.1.1.1',
  userAgent: 'jest',
  startedAt: at,
  lastAccessAt: at,
  closedAt: null,
  closeReason: null,
  createdAt: at,
  sessionUser: user,
  device: { userTrustedDeviceId: ID, deviceName: 'PC', deviceType: 'desktop', browser: 'Chrome', os: 'Windows', status: 'active' }
};
const meta = pageMetadata({ page: 1, limit: 10, sortBy: 'createdAt', order: 'DESC' }, 1);

const ok = (schema: { safeParse(v: unknown): { error?: { issues: unknown[] } } }, value: unknown) =>
  expect(schema.safeParse(value).error?.issues ?? []).toEqual([]);

describe('esquemas de salida de audit', () => {
  it('logs y alertas', () => {
    ok(AuditLogSchema, components.AuditLogComponent.buildList(log));
    ok(AuditLogDetailSchema, components.AuditLogComponent.buildDetail(log));
    ok(AuditLogDetailSchema, components.AuditLogComponent.buildDetail({ ...log, details: null, executor: null }));
    ok(AuditAlertSchema, components.AuditAlertComponent.build(alert));
  });

  it('catálogo de acciones', () => {
    ok(AuditActionCategorySchema, catalogDto.CategoryDTO({ category: 'KYC', actionsCount: 3 }));
    ok(AuditActionRiskSchema, catalogDto.RiskDTO({ risk: 'high', actionsCount: 3 }));
    ok(AuditActionModuleSchema, catalogDto.ModuleDTO({ module: 'admin', actionsCount: 3 }));
    ok(AuditActionCatalogItemSchema, catalogDto.ActionListDTO({ action: 'X', description: 'd', category: 'KYC', risk: 'low' }));
  });

  it('operaciones: ítem y línea de tiempo', () => {
    ok(OperationSchema, operationDto.OperationListDTO([operation as never], meta).data[0]);
    ok(
      OperationTimelineSchema,
      operationDto.OperationTimelineDTO({
        operation: operation as never,
        children: [operation as never],
        auditEvents: [log as never]
      })
    );
  });

  it('traza de sesión: cabecera, timeline y entidades', () => {
    ok(SessionTraceListItemSchema, sessionDto.SessionHeaderDTO(session as never, 3));
    ok(SessionTraceListItemSchema, sessionDto.SessionHeaderDTO({ ...session, device: null } as never));
    ok(SessionTimelineEventSchema, sessionDto.TimelineEventDTO(log as never, true));
    ok(
      SessionEntitiesSchema,
      sessionDto.SessionEntitiesDTO(
        ID,
        [{ entityTable: 't', entityType: 'T', count: 1, items: [{}] }],
        [{ entityTable: 'u', count: 2 }]
      )
    );
  });

  it('actividad del propio usuario: acción y cambio de cuenta', () => {
    const devices = new Map([[ID, { deviceId: ID, name: 'PC' }]]);
    const { data } = activityDto.UserActivityListResponseDTO(
      [
        { __source: 'audit', row: log as never, at },
        {
          __source: 'change',
          row: { logId: ID, changeType: 'email', changedByRole: 'admin', originSessionId: null, createdAt: at } as never,
          at
        }
      ],
      meta,
      devices
    );
    data.forEach(item => ok(UserActivityItemSchema, item));
  });
});
