// Controladores HTTP de audit: HTTP ↔ casos de uso, sin reglas de negocio. Uno por recurso.
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import routeParamUtilModule from '../../../../shared/presentation/http/route-param.util';
import { validQuery } from '../../../../shared/presentation/validation/validate';
import type { ListAuditLogs } from '../../application/use-cases/list-audit-logs.use-case';
import type { GetAuditLog } from '../../application/use-cases/get-audit-log.use-case';
import type { ExportAuditLogs } from '../../application/use-cases/export-audit-logs.use-case';
import type { ListAuditAlerts } from '../../application/use-cases/list-audit-alerts.use-case';
import type { AcknowledgeAuditAlert, AcknowledgeAuditAlerts } from '../../application/use-cases/acknowledge-audit-alerts.use-case';
import type {
  GetAuditCategories,
  GetAuditModules,
  GetAuditRisks,
  ListAuditActions
} from '../../application/use-cases/audit-action-catalog.use-cases';
import type { ListUserChangeLogs } from '../../application/use-cases/list-user-change-logs.use-case';
import type { GetOperationTimeline, ListOperations } from '../../application/use-cases/operations.use-cases';
import type { GetSessionEntities, GetSessionTimeline, ListSessionTraces } from '../../application/use-cases/session-trace.use-cases';
import type { GetRecentActivity } from '../../application/use-cases/get-recent-activity.use-case';
import {
  AuditActionListQuery,
  AuditAlertListQuery,
  AuditLogExportQuery,
  AuditLogListQuery,
  ChangeLogListQuery,
  OperationListQuery,
  RecentActivityQuery,
  SessionEntitiesQuery,
  SessionListQuery,
  SessionTimelineQuery
} from './requests/audit.request';
import { writeAuditLogCsv, writeAuditLogXlsx } from './audit-log-export.writer';

const { asyncHandler } = errorMiddlewareModule;
const { requireAuthUser } = authUserUtilModule;
const { routeParam } = routeParamUtilModule;
const actorOf = (req: Request) => requireAuthUser(req).userId;

export class AuditLogController {
  constructor(
    private readonly listLogs: ListAuditLogs,
    private readonly getLog: GetAuditLog,
    private readonly exportLogs: ExportAuditLogs
  ) {}

  list = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.listLogs.execute({ actorId: actorOf(req), query: validQuery(req, AuditLogListQuery) });
    return ApiResponse.success(res, 'Logs de auditoría obtenidos exitosamente', result);
  });

  getById = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.getLog.execute({ actorId: actorOf(req), auditLogId: routeParam(req, 'auditLogId') });
    return ApiResponse.success(res, 'Log de auditoría obtenido exitosamente', data);
  });

  export = asyncHandler(async (req: Request, res: Response) => {
    const { format: requested, ...filters } = validQuery(req, AuditLogExportQuery);
    const format = requested === 'xlsx' ? 'xlsx' : 'csv';
    const { rows, truncated } = await this.exportLogs.execute({ actorId: actorOf(req), filters, format });
    if (format === 'xlsx') {
      await writeAuditLogXlsx(res, rows, truncated);
      return;
    }
    writeAuditLogCsv(res, rows, truncated);
  });
}

export class AuditAlertController {
  constructor(
    private readonly listAlerts: ListAuditAlerts,
    private readonly acknowledgeAlert: AcknowledgeAuditAlert,
    private readonly acknowledgeAlerts: AcknowledgeAuditAlerts
  ) {}

  list = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.listAlerts.execute({ actorId: actorOf(req), query: validQuery(req, AuditAlertListQuery) });
    return ApiResponse.success(res, 'Alertas de auditoría obtenidas exitosamente', result);
  });

  acknowledge = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.acknowledgeAlert.execute({ actorId: actorOf(req), alertId: routeParam(req, 'alertId') });
    return ApiResponse.success(res, 'Alerta reconocida exitosamente', data);
  });

  acknowledgeBulk = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.acknowledgeAlerts.execute({ actorId: actorOf(req), alertIds: (req.body as { alertIds: string[] }).alertIds });
    return ApiResponse.success(res, `${data.acknowledged} alertas reconocidas exitosamente`, data);
  });
}

export class AuditActionCatalogController {
  constructor(
    private readonly getCategories: GetAuditCategories,
    private readonly getRisks: GetAuditRisks,
    private readonly getModules: GetAuditModules,
    private readonly listActions: ListAuditActions
  ) {}

  categories = asyncHandler((req: Request, res: Response) =>
    ApiResponse.success(res, 'Categorías de auditoría obtenidas exitosamente', this.getCategories.execute({ actorId: actorOf(req) }))
  );

  risks = asyncHandler((req: Request, res: Response) =>
    ApiResponse.success(res, 'Niveles de riesgo de auditoría obtenidos exitosamente', this.getRisks.execute({ actorId: actorOf(req) }))
  );

  modules = asyncHandler((req: Request, res: Response) =>
    ApiResponse.success(res, 'Módulos de auditoría obtenidos exitosamente', this.getModules.execute({ actorId: actorOf(req) }))
  );

  actions = asyncHandler((req: Request, res: Response) => {
    const result = this.listActions.execute({ actorId: actorOf(req), query: validQuery(req, AuditActionListQuery) });
    return ApiResponse.success(res, 'Catálogo de acciones de auditoría obtenido exitosamente', result);
  });
}

export class ChangeLogController {
  constructor(private readonly listChangeLogs: ListUserChangeLogs) {}

  listUserChangeLogs = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.listChangeLogs.execute({ actorId: actorOf(req), query: validQuery(req, ChangeLogListQuery) });
    return ApiResponse.success(res, 'Logs de cambios de usuarios obtenidos exitosamente', result);
  });
}

export class OperationController {
  constructor(
    private readonly listOperations: ListOperations,
    private readonly getTimeline: GetOperationTimeline
  ) {}

  list = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.listOperations.execute({ actorId: actorOf(req), query: validQuery(req, OperationListQuery) });
    return ApiResponse.success(res, 'Operaciones obtenidas exitosamente', result);
  });

  timeline = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.getTimeline.execute({ actorId: actorOf(req), operationId: routeParam(req, 'operationId') });
    return ApiResponse.success(res, 'Línea de tiempo de la operación obtenida exitosamente', result);
  });
}

export class SessionTraceController {
  constructor(
    private readonly listSessions: ListSessionTraces,
    private readonly getTimeline: GetSessionTimeline,
    private readonly getEntities: GetSessionEntities
  ) {}

  list = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.listSessions.execute({ actorId: actorOf(req), query: validQuery(req, SessionListQuery) });
    return ApiResponse.success(res, 'Sesiones obtenidas exitosamente', result);
  });

  timeline = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.getTimeline.execute({
      actorId: actorOf(req),
      sessionId: routeParam(req, 'sessionId'),
      query: validQuery(req, SessionTimelineQuery)
    });
    return ApiResponse.success(res, 'Traza de sesión obtenida exitosamente', result);
  });

  entities = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.getEntities.execute({
      actorId: actorOf(req),
      sessionId: routeParam(req, 'sessionId'),
      entityTable: validQuery(req, SessionEntitiesQuery).entityTable
    });
    return ApiResponse.success(res, 'Entidades de la sesión obtenidas exitosamente', result);
  });
}

export class UserActivityController {
  constructor(private readonly getRecentActivity: GetRecentActivity) {}

  /** GET /audit/recent-activity — feed de actividad del propio usuario autenticado */
  list = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.getRecentActivity.execute({ userId: actorOf(req), query: validQuery(req, RecentActivityQuery) });
    return ApiResponse.success(res, 'Actividad reciente obtenida exitosamente', result);
  });
}
