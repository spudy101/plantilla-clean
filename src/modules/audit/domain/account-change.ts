// Bitácora de cambios sobre una cuenta (email, contraseña, MFA, estado, rol…).
//
// No es una tabla propia: cada cambio es un registro USER_FIELD_CHANGED en audit_logs con el valor anterior
// y el nuevo en `details`. Al mostrarlos, los valores sensibles salen enmascarados.
import MaskingUtil from '../../../shared/domain/pii/masking.util';
import type { AuditFact, UserRef } from './audit-log';

export const ACCOUNT_CHANGE_ACTION = 'USER_FIELD_CHANGED';

/** Campos de la cuenta cuyo cambio queda en la bitácora. */
export type ChangeType =
  | 'email' | 'password' | 'mfa_status' | 'account_status' | 'role' | 'national_id' | 'name' | 'gender'
  | 'location' | 'phone' | 'birth_date' | 'funds_origin' | 'sms_mfa_status' | 'preferred_mfa_method';
export type ChangedByRole = 'admin' | 'user' | 'system';

/** Un cambio sobre la cuenta `userId`. */
export interface AccountChange {
  userId: string;
  changedByUserId?: string | null;
  changedByRole: ChangedByRole;
  changeType: ChangeType;
  previousValue?: string | null;
  newValue?: string | null;
  changeReason?: string | null;
  /** Ignorados: ip y user-agent salen del contexto de la operación. */
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** El hecho de auditoría de un cambio: lo ejecuta quien lo hizo (el propio usuario, un admin o el sistema). */
export function accountChangeFact(change: AccountChange): AuditFact {
  return {
    actorId: change.changedByUserId ?? (change.changedByRole === 'user' ? change.userId : 'system'),
    entityType: 'User',
    entityTable: 'users',
    entityId: change.userId,
    details: {
      changeType: change.changeType,
      changedByRole: change.changedByRole,
      previousValue: change.previousValue ?? null,
      newValue: change.newValue ?? null,
      changeReason: change.changeReason ?? null
    }
  };
}

/** Un cambio de la bitácora, leído de su registro. */
export interface ChangeLogEntry {
  logId: string;
  userId: string;
  changedByUserId: string | null;
  changedByRole: ChangedByRole;
  changeType: ChangeType;
  previousValue: string | null;
  newValue: string | null;
  changeReason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  originSessionId: string | null;
  createdAt: Date;
}

export interface ChangeLogWithUsers extends ChangeLogEntry {
  /** Usuario afectado. */
  user: UserRef | null;
  /** Quién hizo el cambio (null si fue el sistema). */
  changedBy: UserRef | null;
}

const SENSITIVE_CHANGE_TYPES = new Set(['email', 'phone', 'national_id']);

/**
 * Cómo se muestra un valor de la bitácora: el correo enmascarado como correo, documento y teléfono como
 * documento; para el resto, si el valor TIENE forma de correo o de número se enmascara (un estado como
 * 'activo' pasa intacto). [RF-USR-01] CA-06.
 */
export function maskChangeValue(value: unknown, changeType: string): unknown {
  if (!value) {
    return value;
  }
  if (changeType === 'email') {
    return MaskingUtil.maskEmail(value);
  }
  if (SENSITIVE_CHANGE_TYPES.has(changeType)) {
    return MaskingUtil.maskDocumentId(value);
  }
  return MaskingUtil.maskAuto(value);
}
