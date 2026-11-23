// Feed de actividad del PROPIO usuario (vista cliente). Mezcla dos fuentes:
//   - lo que el usuario hizo: sus registros de auditoría, solo de las acciones de la lista client-safe;
//   - lo que un tercero (admin o sistema) cambió en su cuenta: la bitácora de cambios.
// Nunca expone `details`, valores anteriores/nuevos, user-agent ni datos de terceros.
import type { ChangedByRole, ChangeType } from './account-change';

// Hitos que el usuario entiende y le pertenecen. Nada de lecturas (*_VIEWED, ruido) ni acciones
// administrativas. Ampliar acá = aparece en el feed.
export const CLIENT_SAFE_AUDIT_ACTIONS: readonly string[] = Object.freeze([
  // Sesiones y seguridad
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGIN_BLOCKED_DEVICE',
  'ACCOUNT_BLOCKED',
  'PASSWORD_CHANGED',
  'MFA_TOTP_ACTIVATED',
  'MFA_TOTP_DEACTIVATED',
  'MFA_SMS_ACTIVATED',
  'MFA_SMS_DEACTIVATED',
  'MFA_PREFERRED_METHOD_UPDATED',
  'LOGOUT',
  'LOGOUT_ALL',
  'LOGOUT_OTHERS',
  'SESSION_CLOSED_BY_USER',
  'SESSION_REVOKED_BY_ADMIN',
  // Dispositivos de confianza
  'TRUSTED_DEVICE_ADDED',
  'TRUSTED_DEVICE_ADDED_FIRST',
  'TRUSTED_DEVICE_PENDING',
  'TRUSTED_DEVICE_RENAMED',
  'TRUSTED_DEVICE_REMOVED',
  'TRUSTED_DEVICE_APPROVED',
  'TRUSTED_DEVICE_BLOCKED',
  'TRUSTED_DEVICE_UNBLOCKED',
  // Perfil
  'PROFILE_UPDATED',
  'PROFILE_EMAIL_UPDATED',
  'PROFILE_PHONE_UPDATED',
  'NATIONAL_ID_UPDATED',
  'PRIVACY_POLICY_ACCEPTED'
]);

/** Quién puede cambiar la cuenta de un usuario además de él mismo: esos cambios van al feed. */
export const EXTERNAL_CHANGE_ROLES: readonly ChangedByRole[] = Object.freeze(['admin', 'system'] as const);

const CHANGE_TYPE_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  email: 'Actualización del correo electrónico',
  password: 'Cambio de contraseña',
  mfa_status: 'Cambio en la autenticación de dos factores',
  account_status: 'Cambio del estado de la cuenta',
  role: 'Cambio de rol de la cuenta',
  national_id: 'Actualización del documento de identidad',
  name: 'Actualización del nombre',
  gender: 'Actualización del género',
  location: 'Actualización de la ubicación',
  phone: 'Actualización del teléfono',
  birth_date: 'Actualización de la fecha de nacimiento',
  funds_origin: 'Actualización del origen de fondos',
  sms_mfa_status: 'Cambio en la verificación por SMS',
  preferred_mfa_method: 'Cambio del método preferido de verificación'
});

/** Cómo se describe al usuario un cambio sobre su cuenta. */
export function describeChange(changeType: string): string {
  return CHANGE_TYPE_DESCRIPTIONS[changeType] ?? 'Actualización de datos de la cuenta';
}

/** Lo que el usuario hizo (registro de auditoría, solo campos client-safe). */
export interface OwnActivity {
  auditLogId: string;
  action: string;
  description: string | null;
  category: string | null;
  outcome: string | null;
  ip: string | null;
  sessionId: string | null;
  createdAt: Date;
}

/** Lo que un tercero cambió en su cuenta (sin valores). */
export interface ExternalChange {
  logId: string;
  changeType: ChangeType;
  changedByRole: ChangedByRole;
  originSessionId: string | null;
  createdAt: Date;
}

export type FeedItem = { source: 'audit'; activity: OwnActivity } | { source: 'change'; change: ExternalChange };

const at = (item: FeedItem) => (item.source === 'audit' ? item.activity.createdAt : item.change.createdAt);

/** Las dos fuentes mezcladas por fecha (más reciente primero) y cortadas a la página pedida. */
export function mergeFeed(own: OwnActivity[], external: ExternalChange[], offset: number, limit: number): FeedItem[] {
  return [
    ...own.map((activity): FeedItem => ({ source: 'audit', activity })),
    ...external.map((change): FeedItem => ({ source: 'change', change }))
  ]
    .sort((a, b) => new Date(at(b) ?? 0).getTime() - new Date(at(a) ?? 0).getTime())
    .slice(offset, offset + limit);
}

/** Sesión de la que salió cada ítem (para mostrar el dispositivo del propio usuario). */
export function sessionIdsOf(items: FeedItem[]): string[] {
  const ids = items.map(item => (item.source === 'audit' ? item.activity.sessionId : item.change.originSessionId));
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}
