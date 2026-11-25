// Controlador HTTP del panel admin de doble aprobación: HTTP ↔ casos de uso, sin reglas de negocio.
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import routeParamUtilModule from '../../../../shared/presentation/http/route-param.util';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import adminAuditContextUtilModule from '../../../../shared/presentation/http/admin-audit-context.util';
import { validQuery } from '../../../../shared/presentation/validation/validate';
import type {
  GetApprovalPolicy,
  GetApprovalRequest,
  ListApprovalRequests
} from '../../application/use-cases/approval-request-queries.use-cases';
import type { ResolveApprovalRequest } from '../../application/use-cases/resolve-approval-request.use-case';
import { ApprovalListQuery, type ResolveApprovalBody } from './requests/approval-request.request';

const { asyncHandler } = errorMiddlewareModule;
const { routeParam } = routeParamUtilModule;
const { requireAuthUser } = authUserUtilModule;
const { adminAuditContext } = adminAuditContextUtilModule;

export class ApprovalRequestController {
  constructor(
    private readonly listRequests: ListApprovalRequests,
    private readonly getRequest: GetApprovalRequest,
    private readonly getApprovalPolicy: GetApprovalPolicy,
    private readonly resolveRequest: ResolveApprovalRequest
  ) {}

  /** GET /approval-requests — la página entera ({ data, metadata }) va en `data`, como siempre respondió. */
  list = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.listRequests.execute({ actorId: requireAuthUser(req).userId, query: validQuery(req, ApprovalListQuery) });
    return ApiResponse.success(res, 'Solicitudes de aprobación obtenidas exitosamente', result);
  });

  /** GET /approval-requests/policy */
  getPolicy = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.getApprovalPolicy.execute({ actorId: requireAuthUser(req).userId });
    return ApiResponse.success(res, 'Política de doble aprobación obtenida exitosamente', data);
  });

  /** GET /approval-requests/:id */
  getById = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.getRequest.execute({ actorId: requireAuthUser(req).userId, approvalRequestId: routeParam(req, 'id') });
    return ApiResponse.success(res, 'Solicitud de aprobación obtenida exitosamente', data);
  });

  /** POST /approval-requests/:id/resolve */
  resolve = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as ResolveApprovalBody;
    const data = await this.resolveRequest.execute({
      approvalRequestId: routeParam(req, 'id'),
      decision: body.decision,
      notes: body.notes,
      ctx: adminAuditContext(req, res)
    });
    const message = body.decision === 'approve' ? 'Solicitud aprobada exitosamente' : 'Solicitud rechazada exitosamente';
    return ApiResponse.success(res, message, data);
  });
}
