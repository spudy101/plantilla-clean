// Middleware de ruta de la doble aprobación, para operaciones cuyo disparo se decide con req.body/req.params.
// Si la operación requiere segunda aprobación responde 202 Accepted con la solicitud y NO sigue al controller; si
// no, llama next() y el controller ejecuta normal.
//
// Para operaciones cuya condición se calcula a mitad del flujo, el gate va en el caso de uso (GateOperation).
// approvals.module.ts lo entrega armado (`requireDualApproval`).
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import authUserUtil from '../../../../shared/presentation/http/auth-user.util';
import dualApprovalModule from '../../../../shared/domain/constants/dual-approval';
import type { GateOperation } from '../../application/use-cases/gate-operation.use-case';

const { asyncHandler } = errorMiddlewareModule;
const { requireAuthUser } = authUserUtil;
const { DUAL_APPROVAL_OPS } = dualApprovalModule;

/** Opciones del gate a nivel de ruta. */
export interface DualApprovalGateOptions {
  /** Si devuelve false se salta el gate (endpoints multipropósito: activar/desactivar, un update que a veces toca el campo gateado). */
  shouldGate?: (req: Request) => boolean | Promise<boolean>;
  /** Payload a guardar en la solicitud (default: req.body). */
  extractPayload?: (req: Request) => unknown;
  /** Entidad afectada (default: la del registro + req.params.id). */
  extractEntity?: (req: Request) => { entityType: string; entityId: string };
}

export type RequireDualApproval = (operationKey: keyof typeof DUAL_APPROVAL_OPS, options?: DualApprovalGateOptions) => RequestHandler;

export function createRequireDualApproval(gate: GateOperation): RequireDualApproval {
  return (operationKey, options = {}) => {
    const op = DUAL_APPROVAL_OPS[operationKey];
    if (!op) {
      throw new Error(`[DualApprovalMiddleware] Operación desconocida: ${operationKey}`);
    }
    const { shouldGate, extractPayload, extractEntity } = options;

    return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
      if (shouldGate && !(await shouldGate(req))) {
        return next();
      }

      const entity = extractEntity ? extractEntity(req) : { entityType: op.entityType, entityId: req.params.id };
      const user = requireAuthUser(req);
      const result = await gate.execute(operationKey, {
        entityType: entity.entityType,
        entityId: entity.entityId,
        payload: extractPayload ? extractPayload(req) : req.body,
        ctx: {
          adminUserId: user.userId,
          adminRoleName: user.roleName,
          adminFirstName: user.firstName,
          ipAddress: res.locals.auditContext?.ip,
          userAgent: res.locals.auditContext?.userAgent
        }
      });

      if (result.pending) {
        return ApiResponse.accepted(res, 'Operación pendiente de segunda aprobación', result.request);
      }
      return next();
    });
  };
}
