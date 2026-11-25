// @deprecated TRANSITORIO: la doble aprobación para iam (todavía sin migrar), por el index.ts. Usa los casos de uso
// que dejó armados approvals.module.ts:
//
//   const gate = await dualApproval.gate('RBAC_ROLE_CHANGE', { entityType: 'User', entityId, payload, ctx });
//   await dualApproval.annotatePending('User', rows, 'userId');   // rows[i].pendingApproval = { … } | null
//
// Cuando iam se migre, recibirá GateOperation y FindPendingApprovals por un puerto suyo y esto se borra.
import type { GateInput } from '../../application/use-cases/gate-operation.use-case';
import type { GateOutput } from '../../application/dto/approval-request.output';

export interface LegacyBindings {
  gate(operationKey: string, input: GateInput): Promise<GateOutput>;
  findPending(entityType: string, entityIds: string[]): Promise<Map<string, unknown>>;
}

let bindings: LegacyBindings | null = null;

export function bindLegacyApprovals(next: LegacyBindings): void {
  bindings = next;
}

function legacyBindings(): LegacyBindings {
  if (!bindings) {
    throw new Error('El módulo approvals no está armado: src/main/container.ts (createContainer) todavía no corrió');
  }
  return bindings;
}

/** Si la operación necesita un segundo funcionario: pendiente (202) o sigue de inmediato. */
export function gate(operationKey: string, input: GateInput): Promise<GateOutput> {
  return legacyBindings().gate(operationKey, input);
}

/**
 * Anota cada fila con `pendingApproval` (la pendiente sobre esa entidad, o null) en una sola consulta. `idField`
 * es el campo con el id de la entidad (`userId`…). Devuelve las mismas filas (mutadas) para encadenar.
 */
export async function annotatePending<R extends object>(entityType: string, rows: R[], idField: string): Promise<R[]> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return rows;
  }
  const asRecord = (row: R) => row as unknown as Record<string, unknown>;
  const ids = rows.map(row => asRecord(row)[idField]).filter((id): id is string => typeof id === 'string' && id !== '');
  const pending = await legacyBindings().findPending(entityType, ids);
  for (const row of rows) {
    asRecord(row).pendingApproval = pending.get(asRecord(row)[idField] as string) ?? null;
  }
  return rows;
}

export default { gate, annotatePending };
