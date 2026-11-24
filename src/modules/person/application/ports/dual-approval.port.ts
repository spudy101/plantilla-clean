// Puerto: la doble aprobación (maker-checker), que es de approvals. Una operación gateada queda pendiente y la
// ejecuta después un segundo funcionario; si no hace falta (flag apagado, super_admin), sigue de inmediato.
import type { AdminAuditContext } from '../../../../shared/application/audit-context';

export type GateResult = { pending: false } | { pending: true; request: unknown };

export interface DualApprovalGate {
  gate(
    operationKey: 'CLIENT_ACCOUNT_DELETE',
    args: { entityType: string; entityId: string; payload: Record<string, unknown>; ctx: AdminAuditContext }
  ): Promise<GateResult>;
}
