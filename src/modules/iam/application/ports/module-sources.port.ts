// Puertos: lo que iam necesita de los demás módulos (además de la persona: ver account-holders.port.ts).
//
//   PrivacyPolicies, ConsentRecorder   legal: la política vigente y la constancia de lo que el usuario aceptó
//   VerificationCodes                  notification: los códigos OTP (email verificado, MFA y login por SMS)
//   SmsSender, PushDevices             notification: el SMS del código y el dispositivo push del login mobile
//   NotificationPreferences            notification: la preferencia inicial del usuario nuevo
//   CatalogLookups                     catalogs: país, tipo de documento y género
//   AccountChangeLog                   audit: la bitácora de cambios de la cuenta
//   AuthAttemptLog, AccountChangeHistory  audit: lo que muestran las vistas admin de sesiones y de usuarios
//   DualApproval                       approvals: el gate maker-checker y el badge de pendientes
//
// Los implementa src/main/adapters/iam-sources.adapter.ts con los casos de uso de cada módulo.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { ActivePolicy } from '../../domain/login';
import type { OtpCode } from '../../domain/mfa';
import type { UserRefView } from '../../domain/user-ref';

// ── legal ──────────────────────────────────────────────────────
export interface PrivacyPolicies {
  findActive(): Promise<ActivePolicy | null>;
}

export interface ConsentRecorder {
  /** null si no hay consentimiento que registrar (sin política activa). */
  grantPrivacyPolicy(input: { userId: string; privacyPolicyId?: string; ip: string | null }): Promise<{ userConsentId: string } | null>;
  grantCommercialCommunications(input: { userId: string; ip: string | null }): Promise<{ userConsentId: string } | null>;
}

// ── notification ───────────────────────────────────────────────
export type ContactKind = 'email' | 'phone';

export interface VerificationCodes {
  /** Segundos que faltan para poder pedir otro código (0 = ya se puede). */
  secondsUntilNewCode(kind: ContactKind, value: string): Promise<number>;
  create(code: { type: ContactKind; contactValue: string; code: string; expiresAt: Date }): Promise<{ verificationCodeId: string }>;
  /** El último vigente y sin verificar. */
  findActive(kind: ContactKind, value: string): Promise<OtpCode | null>;
  incrementAttempts(verificationCodeId: string): Promise<void>;
  markAsVerified(verificationCodeId: string): Promise<void>;
  /** ¿El contacto tiene un código ya verificado (email confirmado antes de registrarse)? */
  isVerified(kind: ContactKind, value: string): Promise<boolean>;
  consumeVerified(kind: ContactKind, value: string): Promise<void>;
}

export interface SmsSender {
  /** Nunca lanza por un fallo de envío: lo informa en el resultado. */
  send(sms: { phoneNumber: string; message: string; userId: string | null; purpose: string }): Promise<{ success: boolean; error?: unknown }>;
  /** El número local + el prefijo de su país (E.164). */
  resolveE164(localNumber: string, prefixId: string | null): Promise<string>;
}

export interface PushDevices {
  /** Registra el token FCM en el proveedor y lo asocia al usuario (un dispositivo compartido cambia de dueño). */
  register(input: { userId: string; token: string; platform: string; deviceId: string | null }): Promise<void>;
}

export interface NotificationPreferences {
  /** Todos los canales, sin horario de silencio. Corre dentro de la unidad de trabajo del alta. */
  createDefault(userId: string): Promise<void>;
}

// ── catalogs ───────────────────────────────────────────────────
export interface DocumentTypeEntry {
  documentTypeId: string;
  isActive: boolean | null;
  isVisibleToClient: boolean | null;
}

export interface CatalogLookups {
  countryByCode(code: string): Promise<{ countryId: string } | null>;
  documentType(documentTypeId: string): Promise<DocumentTypeEntry | null>;
  /** Activo, por su sigla (p. ej. 'SYSTEM'). */
  documentTypeByCode(code: string): Promise<{ documentTypeId: string } | null>;
  genderExists(genderId: string): Promise<boolean>;
}

// ── audit ──────────────────────────────────────────────────────
export type AccountChangeType =
  | 'role'
  | 'account_status'
  | 'mfa_status'
  | 'sms_mfa_status'
  | 'preferred_mfa_method';

export interface AccountChange {
  userId: string;
  changedByUserId: string | null;
  changedByRole: 'admin' | 'user' | 'system';
  changeType: AccountChangeType;
  previousValue: string | null;
  newValue: string | null;
  changeReason: string;
}

export interface AccountChangeLog {
  record(change: AccountChange): Promise<void>;
}

/** Un intento de autenticación (registro de auditoría de la categoría Autenticación). */
export interface AuthAttempt {
  auditLogId: string;
  action: string;
  description: string | null;
  outcome: string;
  risk: string;
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
  details: unknown;
  createdAt: Date;
  executor: UserRefView | null;
}

export interface AuthAttemptCriteria {
  from: Date;
  to: Date;
  actions?: string[];
  category?: string;
  userId?: string;
  outcome?: string;
}

export interface AuthAttemptLog {
  list(criteria: AuthAttemptCriteria, page: PageRequest): Promise<{ rows: AuthAttempt[]; count: number }>;
}

/** Un cambio de la bitácora de una cuenta, con quién lo hizo. */
export interface AccountChangeRecord {
  logId: string;
  userId: string;
  changedByUserId: string | null;
  changedByRole: string;
  changeType: string;
  previousValue: string | null;
  newValue: string | null;
  changeReason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  originSessionId: string | null;
  createdAt: Date;
  user: UserRefView | null;
  changedBy: UserRefView | null;
}

export interface AccountChangeHistory {
  listByUser(userId: string, page: PageRequest): Promise<{ rows: AccountChangeRecord[]; count: number }>;
}

// ── approvals ──────────────────────────────────────────────────
/** El contexto del funcionario que pide la operación (maker). */
export interface ApprovalContext {
  adminUserId: string;
  adminRoleName?: string | null;
  adminFirstName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface DualApproval {
  /** Pendiente → la operación espera al segundo funcionario; si no, sigue de inmediato. */
  gate(
    operationKey: 'RBAC_ROLE_CHANGE' | 'INTERNAL_USER_DELETE',
    input: { entityType: string; entityId: string; payload: Record<string, unknown>; ctx: ApprovalContext }
  ): Promise<{ pending: true; request: unknown } | { pending: false }>;
  /** La solicitud pendiente sobre cada entidad (las que no tienen, no aparecen). */
  findPending(entityType: string, entityIds: string[]): Promise<Map<string, unknown>>;
}
