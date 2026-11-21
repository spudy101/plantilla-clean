// Middleware de ruta del framework de doble aprobación.
//
// Para operaciones simples cuyo disparo se decide con req.body/req.params (rbac, cambios de rol, config).
// Si la operación requiere segunda aprobación, responde 202 Accepted con el approval_request y
// NO continúa al controller. Si no la requiere, llama next() y el controller ejecuta normal.
//
// Para operaciones cuya condición se calcula a mitad del flujo (umbral sobre un valor ya validado
// dentro del handler), usar el gate a nivel de servicio: DualApprovalService.gate('OP_KEY', {...}).

import type { NextFunction, Request, Response } from 'express';
import ApiResponse from '../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../shared/presentation/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import DualApprovalService from '../services/dual-approval.service';
import dualApprovalModule from '../../../shared/domain/constants/dual-approval';
const { DUAL_APPROVAL_OPS } = dualApprovalModule;
import authUserUtil from '../../../shared/presentation/http/auth-user.util';

const { requireAuthUser } = authUserUtil;

/** Opciones del gate de doble aprobación a nivel de ruta. */
interface DualApprovalGateOptions {
  /** Si devuelve false se salta el gate (endpoints multi-propósito). */
  shouldGate?: (req: Request) => boolean | Promise<boolean>;
  /** Payload a guardar en approval_requests (default: req.body). */
  extractPayload?: (req: Request) => unknown;
  /** Entidad afectada (default: la del registro + req.params.id). */
  extractEntity?: (req: Request) => { entityType: string; entityId: string };
}

class DualApprovalMiddleware {
  /**
   * @param {string} opKey — clave de DUAL_APPROVAL_OPS
   * @param {Object} [options]
   * @param {(req)=>boolean|Promise<boolean>} [options.shouldGate] — si devuelve false se salta el
   *        gate y continúa (para endpoints multi-propósito: toggle activar/desactivar, update que
   *        a veces toca la tasa y a veces no). Si se omite, siempre se evalúa la condición del registro.
   * @param {(req)=>Object}  [options.extractPayload] — payload a guardar (default: req.body)
   * @param {(req)=>{entityType:string, entityId:string}} [options.extractEntity]
   */
  static require(opKey: keyof typeof DUAL_APPROVAL_OPS, options: DualApprovalGateOptions = {}) {
    const op = DUAL_APPROVAL_OPS[opKey];
    if (!op) {
      throw new Error(`[DualApprovalMiddleware] Operación desconocida: ${opKey}`);
    }
    const { shouldGate, extractPayload, extractEntity } = options;

    return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
      if (shouldGate && !(await shouldGate(req))) {
        return next();
      }

      const payload = extractPayload ? extractPayload(req) : req.body;
      const entity = extractEntity ? extractEntity(req) : { entityType: op.entityType, entityId: req.params.id };
      const ctx = _ctxFromReq(req, res);

      const result = await DualApprovalService.gate(opKey, {
        entityType: entity.entityType,
        entityId: entity.entityId,
        payload,
        ctx
      });

      if (result.pending) {
        return ApiResponse.accepted(res, 'Operación pendiente de segunda aprobación', result.request);
      }
      return next();
    });
  }
}

function _ctxFromReq(req: Request, res: Response) {
  const user = requireAuthUser(req);
  return {
    adminUserId: user.userId,
    adminRoleName: user.roleName,
    adminFirstName: user.firstName,
    ipAddress: res.locals.auditContext?.ip,
    userAgent: res.locals.auditContext?.userAgent
  };
}

export default DualApprovalMiddleware;
