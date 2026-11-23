// Conformidad: la salida de los casos de uso de audit cumple los esquemas (estrictos) que documenta Swagger.
import type { z } from '../../../../../shared/presentation/validation/z';
import { pageMetadata } from '../../../../../shared/application/pagination';
import {
  toAuditAlertOutput,
  toAuditLogDetailOutput,
  toAuditLogListItemOutput,
  toChangeLogOutput
} from '../../../application/dto/audit-log.output';
import {
  toActivityItemOutput,
  toOperationOutput,
  toOperationTimelineOutput,
  toSessionEntitiesOutput,
  toSessionHeaderOutput,
  toTimelineEventOutput
} from '../../../application/dto/trace.output';
import { categoriesWithCounts, modulesWithCounts, risksWithCounts, searchActions } from '../../../domain/action-catalog';
import { AlertsAcknowledgedSchema, AuditAlertSchema, AuditLogDetailSchema, AuditLogSchema, ChangeLogSchema } from './audit-components.response';
import {
  AuditActionCatalogItemSchema,
  AuditActionCategorySchema,
  AuditActionModuleSchema,
  AuditActionRiskSchema
} from './admin-audit-action-catalog.response';
import { OperationSchema, OperationTimelineSchema } from './admin-operation.response';
import { SessionEntitiesSchema, SessionTimelineEventSchema, SessionTraceListItemSchema } from './admin-session-trace.response';
import { UserActivityItemSchema } from './user-activity.response';
import { auditAlert, auditLog, operation, tracedSession, USER_ID } from '../../../../../../tests/doubles/audit.doubles';

const ok = (schema: z.ZodObject, value: unknown) => expect(schema.strict().safeParse(value).error?.issues ?? []).toEqual([]);

describe('audit — salida conforme al esquema', () => {
  it('logs, detalle, alertas y bitácora de cambios', () => {
    ok(AuditLogSchema, toAuditLogListItemOutput(auditLog()));
    ok(AuditLogSchema, toAuditLogListItemOutput(auditLog({ executor: null, sessionId: null, module: null })));
    ok(AuditLogDetailSchema, toAuditLogDetailOutput(auditLog({ details: { before: { email: 'ana@correo.com' } } })));
    ok(AuditAlertSchema, toAuditAlertOutput(auditAlert({ acknowledged: true, acknowledgedBy: USER_ID, acknowledgedAt: new Date() })));
    ok(AlertsAcknowledgedSchema, { acknowledged: 1, requested: 2 });
    ok(
      ChangeLogSchema,
      toChangeLogOutput({
        logId: '0f8fad5b-d9cb-469f-a165-70867728950e',
        userId: USER_ID,
        changedByUserId: null,
        changedByRole: 'system',
        changeType: 'email',
        previousValue: 'ana@correo.com',
        newValue: null,
        changeReason: null,
        ipAddress: null,
        userAgent: null,
        originSessionId: null,
        createdAt: new Date(),
        user: { userId: USER_ID, username: 'ana', person: null },
        changedBy: null
      })
    );
  });

  it('catálogo de acciones', () => {
    categoriesWithCounts().forEach(c => ok(AuditActionCategorySchema, c));
    risksWithCounts().forEach(r => ok(AuditActionRiskSchema, r));
    modulesWithCounts().forEach(m => ok(AuditActionModuleSchema, m));
    searchActions({}, 'ASC').forEach(a => ok(AuditActionCatalogItemSchema, a));
  });

  it('operaciones: ítem y línea de tiempo', () => {
    ok(OperationSchema, toOperationOutput(operation()));
    ok(OperationTimelineSchema, toOperationTimelineOutput({ operation: operation(), children: [], auditEvents: [auditLog()] }));
  });

  it('traza de sesión: cabecera, timeline y entidades', () => {
    ok(SessionTraceListItemSchema, toSessionHeaderOutput(tracedSession(), 3));
    ok(SessionTraceListItemSchema, toSessionHeaderOutput(tracedSession({ device: null, user: null })));
    ok(SessionTimelineEventSchema, toTimelineEventOutput(auditLog(), true));
    ok(SessionEntitiesSchema, toSessionEntitiesOutput(tracedSession().sessionId, [{ entityTable: 't', entityType: 'T', count: 0, items: [] }], []));
  });

  it('actividad del propio usuario: acción y cambio de cuenta', () => {
    const devices = new Map([['s1', { deviceId: '4b8e7c2a-9f1d-4e3b-a5c6-7d8e9f0a1b2c', name: 'Mac' }]]);
    const own = { auditLogId: '0f8fad5b-d9cb-469f-a165-70867728950e', action: 'LOGIN_SUCCESS', description: null, category: null, outcome: 'success', ip: null, sessionId: 's1', createdAt: new Date() };
    const change = { logId: '0f8fad5b-d9cb-469f-a165-70867728950e', changeType: 'email' as const, changedByRole: 'admin' as const, originSessionId: null, createdAt: new Date() };
    ok(UserActivityItemSchema, toActivityItemOutput({ source: 'audit', activity: own }, devices));
    ok(UserActivityItemSchema, toActivityItemOutput({ source: 'change', change }, devices));
    expect(pageMetadata({ page: 1, limit: 10, sortBy: 'createdAt', order: 'DESC' }, 0).pagination.totalItems).toBe(0);
  });
});
