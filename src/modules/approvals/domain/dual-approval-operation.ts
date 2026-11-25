// Las operaciones gateadas por la doble aprobación (registro declarativo de shared/domain/constants/dual-approval)
// y sus reglas: si una operación exige segunda aprobación, cuándo vence la solicitud, quién la puede resolver y
// quién se la salta (super_admin).
import dualApprovalConstants from '../../../shared/domain/constants/dual-approval';
import type DualApprovalConstants from '../../../shared/domain/constants/dual-approval';
import rbacConstants from '../../../shared/domain/constants/rbac';
import { addBusinessHours } from './business-hours';
import { ApproverRoleNotAllowedError, UnknownDualApprovalOperationError } from './errors';

const { WILDCARD_ROLES, CONDITION, DEFAULT_TTL_HOURS, DUAL_APPROVAL_OPS } = dualApprovalConstants;
const { SUPERADMIN_ROLE_NAMES } = rbacConstants;

export type DualApprovalOperation = DualApprovalConstants.Op;
export type OperationKey = DualApprovalConstants.OpKey;

/** Las operaciones del registro, con su clave. */
export const operations = (): Array<[string, DualApprovalOperation]> => Object.entries(DUAL_APPROVAL_OPS);

/** La clave llega como texto (base, otros módulos): se busca sin asumir que es válida. */
export function findOperation(operationKey: string): DualApprovalOperation | undefined {
  return (DUAL_APPROVAL_OPS as Record<string, DualApprovalOperation | undefined>)[operationKey];
}

export function operationOf(operationKey: string): DualApprovalOperation {
  const op = findOperation(operationKey);
  if (!op) {
    throw new UnknownDualApprovalOperationError(operationKey);
  }
  return op;
}

export const ttlHoursOf = (op: DualApprovalOperation) => op.ttlHours ?? DEFAULT_TTL_HOURS;

/** Vencimiento de una solicitud creada en `now`: su TTL en horas hábiles. */
export const expiresAtFor = (op: DualApprovalOperation, now: Date) => addBusinessHours(now, ttlHoursOf(op));

export const isThresholdOperation = (op: DualApprovalOperation) => op.condition === CONDITION.THRESHOLD;

/**
 * El umbral vigente de una operación THRESHOLD: el configurado en la base (si la operación declara una clave y hay
 * valor) o su default.
 */
export function thresholdOf(op: DualApprovalOperation, configured: number | null): number {
  if (!op.thresholdConfigKey || configured === null) {
    return op.thresholdDefault ?? 0;
  }
  return configured;
}

/**
 * Si la operación exige segunda aprobación. El maker-checker es incondicional (no hay interruptor global): ALWAYS
 * siempre, THRESHOLD cuando el campo del payload supera el umbral.
 */
export function requiresApproval(op: DualApprovalOperation, payload: unknown, threshold: number): boolean {
  if (op.condition === CONDITION.ALWAYS) {
    return true;
  }
  if (op.condition === CONDITION.THRESHOLD) {
    const value = Number((payload as Record<string, unknown> | null | undefined)?.[op.thresholdField ?? ''] ?? 0);
    return value > threshold;
  }
  return false;
}

/** super_admin omite los cuatro ojos: la solicitud queda aprobada por él mismo. */
export const isSuperAdmin = (roleName: string | null | undefined) => !!roleName && SUPERADMIN_ROLE_NAMES.includes(roleName);

/** Los roles aprobadores de la operación, más los que siempre pueden resolver. Sin rol conocido no se bloquea (ya filtró el RBAC). */
export function assertCanResolve(op: DualApprovalOperation, roleName: string | null | undefined): void {
  if (!roleName) {
    return;
  }
  const allowed = new Set([...(op.approverRoles ?? []), ...WILDCARD_ROLES]);
  if (!allowed.has(roleName)) {
    throw new ApproverRoleNotAllowedError();
  }
}
