// Entrada del módulo de auditoría: consultas de logs, alertas, catálogo de acciones, bitácora de cambios,
// sesiones, operaciones y actividad del usuario. Los valores de los filtros se validan contra el catálogo.
import { z, withHint } from '../../../shared/presentation/validation/z';
import {
  input,
  optionalBool,
  optionalInList,
  optionalIsoDate,
  optionalMax,
  optionalUuid,
  pageQuery,
  pagingQuery,
  searchQuery,
  uuid
} from '../../../shared/presentation/validation/fields';
import catalogModule from '../catalog';
const { AUDIT_ACTIONS, AUDIT_CATEGORIES, AUDIT_RISKS, AUDIT_MODULES, AUDIT_OUTCOMES, AUDIT_SOURCES } = catalogModule;

const ACTIONS = Object.keys(AUDIT_ACTIONS);
const CATEGORIES = Object.values(AUDIT_CATEGORIES);
const RISKS = [...Object.values(AUDIT_RISKS), 'unknown'];
const MODULES = Object.values(AUDIT_MODULES);
const OUTCOMES = Object.values(AUDIT_OUTCOMES);
const SOURCES = Object.values(AUDIT_SOURCES);

const valuesOf = (field: string, values: readonly string[]) =>
  optionalInList(values, { message: `${field} debe ser: ${values.join(', ')}`, hint: `Indicá uno de los valores: ${values.join(', ')}` });
const category = optionalInList(CATEGORIES, {
  message: 'category no es una categoría válida del catálogo',
  hint: `Indicá una de: ${CATEGORIES.join(', ')}`
});
const dateRange = { dateFrom: optionalIsoDate('dateFrom'), dateTo: optionalIsoDate('dateTo') };

// ── Logs de auditoría ─────────────────────────────────────────
const auditLogFilters = {
  ...dateRange,
  action: optionalInList(ACTIONS, {
    message: 'action no es una acción válida del catálogo',
    hint: 'Consultá las acciones válidas en GET /api/audit-action-catalog/actions'
  }),
  userId: optionalUuid('El ID de usuario'),
  sessionId: optionalUuid('El ID de sesión'),
  category,
  outcome: valuesOf('outcome', OUTCOMES),
  risk: valuesOf('risk', RISKS),
  ip: optionalMax('ip', 45),
  correlationId: optionalMax('correlationId', 100),
  entityId: optionalMax('entityId', 255),
  entityType: optionalMax('entityType', 100),
  source: valuesOf('source', SOURCES),
  module: valuesOf('module', MODULES)
};
export const AuditLogListQuery = z.object({ ...pageQuery(['createdAt'], { sortBy: 'createdAt' }), ...auditLogFilters });
export type AuditLogListQuery = z.output<typeof AuditLogListQuery>;
export const AuditLogExportQuery = input({
  ...auditLogFilters,
  format: withHint(z.enum(['csv', 'xlsx'], { error: 'format debe ser csv o xlsx' }).optional(), { hint: 'Indicá uno de los valores: csv, xlsx' })
});
export const AuditLogIdParams = input({ auditLogId: uuid('El ID del log de auditoría') });

// ── Catálogo de acciones ──────────────────────────────────────
// Catálogo en memoria: se ordena por el código de la acción.
export const AuditActionListQuery = z.object({
  ...pageQuery(['action'], { sortBy: 'action', order: 'ASC' }),
  ...searchQuery,
  category,
  risk: valuesOf('risk', RISKS),
  module: valuesOf('module', MODULES)
});
export type AuditActionListQuery = z.output<typeof AuditActionListQuery>;

// ── Alertas ───────────────────────────────────────────────────
export const AuditAlertListQuery = z.object({
  ...pageQuery(['createdAt'], { sortBy: 'createdAt' }),
  ...dateRange,
  acknowledged: optionalBool('El estado'),
  action: optionalMax('action', 100),
  category: optionalMax('category', 50)
});
export type AuditAlertListQuery = z.output<typeof AuditAlertListQuery>;
export const AuditAlertIdParams = input({ alertId: uuid('El ID de la alerta') });
const ALERT_IDS_ERROR = 'alertIds debe ser un array de 1 a 100 elementos';
export const AcknowledgeAlertsBody = input({
  alertIds: withHint(
    z
      .array(z.uuid({ error: 'Cada elemento de alertIds debe ser un UUID válido' }), { error: ALERT_IDS_ERROR })
      .min(1, { error: ALERT_IDS_ERROR })
      .max(100, { error: ALERT_IDS_ERROR }),
    { hint: 'Enviá entre 1 y 100 identificadores en el array' }
  )
});

// ── Bitácora de cambios ───────────────────────────────────────
const CHANGE_TYPES = ['email', 'password', 'mfa_status', 'account_status', 'role', 'national_id'];
export const ChangeLogListQuery = z.object({
  ...pageQuery(['createdAt'], { sortBy: 'createdAt' }),
  ...searchQuery,
  userId: optionalUuid('userId'),
  dateFrom: optionalIsoDate('La fecha desde'),
  dateTo: optionalIsoDate('La fecha hasta'),
  changeType: optionalInList(CHANGE_TYPES, {
    message: 'changeType debe ser un tipo válido',
    hint: `Indicá uno de los valores: ${CHANGE_TYPES.join(', ')}`
  }),
  changedByRole: optionalInList(['admin', 'user', 'system'], {
    message: 'changedByRole debe ser "admin", "user" o "system"',
    hint: 'Indicá uno de los valores: admin, user, system'
  })
});
export type ChangeLogListQuery = z.output<typeof ChangeLogListQuery>;

// ── Sesiones ──────────────────────────────────────────────────
export const SessionListQuery = z.object({
  ...pageQuery(['startedAt'], { sortBy: 'startedAt' }),
  ...dateRange,
  userId: optionalUuid('El ID de usuario'),
  sessionId: optionalUuid('El ID de sesión'),
  status: valuesOf('status', ['active', 'closed']),
  ip: optionalMax('ip', 45)
});
export type SessionListQuery = z.output<typeof SessionListQuery>;
export const SessionIdParams = input({ sessionId: uuid('El ID de sesión') });
/** Línea de tiempo de una sesión: cronológica por defecto. */
export const SessionTimelineQuery = z.object(pageQuery(['createdAt'], { sortBy: 'createdAt', order: 'ASC' }));
export type SessionTimelineQuery = z.output<typeof SessionTimelineQuery>;
/** Actividad reciente del propio usuario: dos fuentes mezcladas por fecha, más reciente primero (orden fijo). */
export const RecentActivityQuery = z.object(pagingQuery);
export type RecentActivityQuery = z.output<typeof RecentActivityQuery>;
export const SessionEntitiesQuery = input({ entityTable: optionalMax('entityTable', 150) });

// ── Operaciones ───────────────────────────────────────────────
export const OperationListQuery = z.object({
  ...pageQuery(['startedAt', 'durationMs'], { sortBy: 'startedAt' }),
  ...dateRange,
  source: valuesOf('source', ['http', 'webhook', 'worker', 'system']),
  status: valuesOf('status', ['running', 'success', 'failure']),
  userId: optionalUuid('El ID de usuario'),
  name: withHint(z.string().trim().max(255, { error: 'name no puede superar 255 caracteres' }).optional(), {
    hint: 'Usá parte del nombre de la ruta o del worker'
  })
});
export type OperationListQuery = z.output<typeof OperationListQuery>;
export const OperationIdParams = input({ operationId: uuid('El ID de la operación') });
