// Las reanudaciones de las operaciones gateadas (IoC). Cada módulo registra la suya (src/main/container.ts): la
// función que ejecuta la acción REAL cuando el checker aprueba. No se re-ejecuta la petición HTTP; el handler
// delega en el mismo caso de uso que la ejecución directa.
import type { AdminAuditContext } from '../../../../shared/application/audit-context';
import { findOperation } from '../../domain/dual-approval-operation';

/** Reanudación (o reacción al rechazo) de una operación; P es la forma del payload que guardó. */
export type ApprovalHandler<P = unknown> = (payload: P, ctx: AdminAuditContext) => Promise<unknown>;

export interface ApprovalHandlerEntry {
  onApprove: ApprovalHandler;
  onReject: ApprovalHandler | null;
}

export class ApprovalHandlers {
  private readonly entries = new Map<string, ApprovalHandlerEntry>();

  /**
   * @param onReject opcional: reacción al rechazo (p. ej. revertir un estado provisional). Sin él, rechazar solo
   *                 cierra la solicitud.
   */
  register<P>(operationKey: string, onApprove: ApprovalHandler<P>, onReject: ApprovalHandler<P> | null = null): void {
    if (!findOperation(operationKey)) {
      throw new Error(`[DualApproval] Operación desconocida al registrar handler: ${operationKey}`);
    }
    if (typeof onApprove !== 'function') {
      throw new Error(`[DualApproval] Handler inválido para ${operationKey}`);
    }
    if (onReject !== null && typeof onReject !== 'function') {
      throw new Error(`[DualApproval] onReject inválido para ${operationKey}`);
    }
    // El Map guarda handlers de payload desconocido: P solo vive en quien registra
    this.entries.set(operationKey, { onApprove: onApprove as ApprovalHandler, onReject: onReject as ApprovalHandler | null });
  }

  find(operationKey: string): ApprovalHandlerEntry | undefined {
    return this.entries.get(operationKey);
  }
}
