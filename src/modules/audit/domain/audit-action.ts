// Las acciones auditables y cómo se clasifica cada registro.
//
// El catálogo (./catalog) es la fuente de verdad: cada acción tiene descripción, categoría, riesgo, módulo
// y si dispara una alerta para el Superadmin. Estas reglas deciden qué se guarda en un registro nuevo.
import catalogModule, { type AuditActionDef, type AuditActionKey } from './catalog';

const { AUDIT_ACTIONS } = catalogModule;

export type { AuditActionDef, AuditActionKey };

export type AuditOutcome = 'success' | 'failure' | 'warning' | 'attempt';
/** Origen técnico del registro; 'unknown' = registrado fuera de toda operación (una anomalía detectable). */
export type AuditSource = 'http' | 'webhook' | 'worker' | 'system' | 'unknown';

const UNKNOWN_ACTION: AuditActionDef = { description: '', category: 'Sin categoría', risk: 'unknown' };

/** La definición de una acción; una acción fuera del catálogo se registra igual, sin clasificar. */
export function definitionOf(action: string): AuditActionDef {
  return (AUDIT_ACTIONS as Record<string, AuditActionDef | undefined>)[action] ?? { ...UNKNOWN_ACTION, description: action };
}

const UUID_REGEX = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

/** 'system' u otros ids que no son de un usuario no se guardan como usuario (la columna apunta a users). */
export function actorUserId(id: string | null | undefined): string | null {
  return id && UUID_REGEX.test(id) ? id : null;
}

/** Un intento fallido (outcome ≠ success) se guarda aparte: la transacción del flujo se va a revertir. */
export function isRecordedIndependently(outcome: AuditOutcome): boolean {
  return outcome !== 'success';
}
