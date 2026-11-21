// Componentes reutilizables de auditoría — RF-ADM-03

import MaskingUtil from '../../../shared/infrastructure/security/masking.util';
import { z } from '../../../shared/presentation/validation/z';
import { dateTime } from '../../../shared/presentation/validation/output';
import type { DbDate, Maybe } from '../../../shared/infrastructure/database/db-rows';

/** Usuario adjunto a una fila de auditoría (Prisma): firstName/lastName viven en Person. */
interface AuditUserRow {
  userId: string;
  username?: Maybe<string>;
  person?: Maybe<{ firstName?: Maybe<string>; lastName?: Maybe<string> }>;
}

// Filas de Prisma (camelCase): audit_logs y audit_alerts migraron en la fase 5 (grupo 5).
interface AuditLogRow {
  auditLogId: string;
  action: string;
  description?: Maybe<string>;
  category?: Maybe<string>;
  module?: Maybe<string>;
  risk?: Maybe<string>;
  outcome?: Maybe<string>;
  httpStatus?: Maybe<number>;
  errorCode?: Maybe<string>;
  errorMessage?: Maybe<string>;
  userId?: Maybe<string>;
  sessionId?: Maybe<string>;
  executor?: Maybe<AuditUserRow>;
  entityId?: Maybe<string>;
  entityType?: Maybe<string>;
  entityTable?: Maybe<string>;
  method?: Maybe<string>;
  path?: Maybe<string>;
  ip?: Maybe<string>;
  source?: Maybe<string>;
  correlationId?: Maybe<string>;
  userAgent?: Maybe<string>;
  fingerprint?: Maybe<string>;
  details?: unknown;
  createdAt?: Maybe<DbDate>;
}

interface AuditAlertRow {
  auditAlertId: string;
  auditLogId?: Maybe<string>;
  action: string;
  category?: Maybe<string>;
  risk?: Maybe<string>;
  userId?: Maybe<string>;
  actor?: Maybe<AuditUserRow>;
  entityId?: Maybe<string>;
  entityType?: Maybe<string>;
  message?: Maybe<string>;
  acknowledged?: Maybe<boolean>;
  acknowledgedBy?: Maybe<string>;
  acknowledgedByUser?: Maybe<AuditUserRow>;
  acknowledgedAt?: Maybe<DbDate>;
  createdAt?: Maybe<DbDate>;
}

// Filas de Prisma (camelCase): consent_types, privacy_policies y user_consents ya migraron (fase 5).
/** Fila de Prisma (fase 5, grupo 3); el horario de no molestar llega como 'HH:MM:SS'. */
interface NotificationPreferenceRow {
  userNotificationPreferenceId: string;
  userId: string;
  allowPush?: Maybe<boolean>;
  allowEmail?: Maybe<boolean>;
  allowSms?: Maybe<boolean>;
  quietHoursStart?: Maybe<string>;
  quietHoursEnd?: Maybe<string>;
  originSessionId?: Maybe<string>;
  createdAt?: Maybe<DbDate>;
  updatedAt?: Maybe<DbDate>;
}

interface TrustedDeviceTraceRow {
  userTrustedDeviceId: string;
  userId: string;
  deviceName?: Maybe<string>;
  deviceType?: Maybe<string>;
  browser?: Maybe<string>;
  os?: Maybe<string>;
  status?: Maybe<string>;
  originSessionId?: Maybe<string>;
  createdAt?: Maybe<DbDate>;
}

function _buildUserRef(user: Maybe<AuditUserRow>) {
  if (!user) {
    return null;
  }
  return {
    userId: user.userId,
    username: user.username,
    fullName: [user.person?.firstName, user.person?.lastName].filter(Boolean).join(' ') || null
  };
}

class AuditLogComponent {
  static buildList(record: Maybe<AuditLogRow>) {
    if (!record) {
      return null;
    }
    return {
      auditLogId: record.auditLogId,
      action: record.action,
      description: record.description || null,
      category: record.category || null,
      module: record.module || null,
      risk: record.risk,
      outcome: record.outcome,
      userId: record.userId || null,
      sessionId: record.sessionId || null,
      executor: _buildUserRef(record.executor),
      entityId: record.entityId || null,
      entityType: record.entityType || null,
      entityTable: record.entityTable || null,
      ip: record.ip || null,
      source: record.source,
      createdAt: record.createdAt
    };
  }

  static buildDetail(record: Maybe<AuditLogRow>) {
    if (!record) {
      return null;
    }
    return {
      ...AuditLogComponent.buildList(record),
      correlationId: record.correlationId || null,
      userAgent: record.userAgent || null,
      fingerprint: record.fingerprint || null,
      // [RF-USR-01] | CA-06 | `details` es JSONB libre de logAudit: guarda diffs con correos y
      // documentos en claro (p. ej. PERSON_EMAIL_CHANGED) → redactor profundo por key.
      details: MaskingUtil.redactPayload(record.details) || null
    };
  }

  static buildArray(records: Maybe<AuditLogRow[]>) {
    if (!records || records.length === 0) {
      return [];
    }
    return records.map(r => AuditLogComponent.buildList(r));
  }
}

class AuditAlertComponent {
  static build(record: Maybe<AuditAlertRow>) {
    if (!record) {
      return null;
    }
    return {
      alertId: record.auditAlertId,
      auditLogId: record.auditLogId || null,
      action: record.action,
      category: record.category || null,
      risk: record.risk,
      userId: record.userId || null,
      user: _buildUserRef(record.actor),
      entityId: record.entityId || null,
      entityType: record.entityType || null,
      message: record.message || null,
      acknowledged: record.acknowledged,
      acknowledgedBy: record.acknowledgedBy || null,
      acknowledgedByUser: _buildUserRef(record.acknowledgedByUser),
      acknowledgedAt: record.acknowledgedAt || null,
      createdAt: record.createdAt
    };
  }

  static buildArray(records: Maybe<AuditAlertRow[]>) {
    if (!records || records.length === 0) {
      return [];
    }
    return records.map(r => AuditAlertComponent.build(r));
  }
}

// ============================================================
// SESSION-TRACE ENTITY COMPONENTS — hidratación forense de acciones del usuario
// Componentes livianos que el ENTITY_REGISTRY del session-trace usa para mostrar QUÉ tocó el
// usuario en una sesión. Sin PII (o enmascarada): esta vista NO es self-view.
// ============================================================

class NotificationPreferenceComponent {
  static build(record: Maybe<NotificationPreferenceRow>) {
    if (!record) {
      return null;
    }
    return {
      userNotificationPreferenceId: record.userNotificationPreferenceId,
      userId: record.userId,
      allowPush: record.allowPush,
      allowEmail: record.allowEmail,
      allowSms: record.allowSms,
      quietHoursStart: record.quietHoursStart ?? null,
      quietHoursEnd: record.quietHoursEnd ?? null,
      originSessionId: record.originSessionId ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }
}

class TrustedDeviceComponent {
  static build(record: Maybe<TrustedDeviceTraceRow>) {
    if (!record) {
      return null;
    }
    return {
      userTrustedDeviceId: record.userTrustedDeviceId,
      userId: record.userId,
      deviceName: record.deviceName ?? null,
      deviceType: record.deviceType ?? null,
      browser: record.browser ?? null,
      os: record.os ?? null,
      status: record.status,
      originSessionId: record.originSessionId ?? null,
      createdAt: record.createdAt
    };
  }
}

export default {
  AuditLogComponent,
  AuditAlertComponent,
  NotificationPreferenceComponent,
  TrustedDeviceComponent
};

// ============================================================
// ESQUEMAS DE SALIDA
// ============================================================

const RISKS = ['low', 'medium', 'high', 'critical', 'unknown'] as const;
const OUTCOMES = ['success', 'failure', 'warning', 'attempt'] as const;

export const AuditUserRefSchema = z.object({
  userId: z.uuid(),
  username: z.string().nullish().meta({ example: 'admin01' }),
  fullName: z.string().nullable().meta({ example: 'María García' })
});

export const AuditLogSchema = z
  .object({
    auditLogId: z.uuid(),
    action: z.string().meta({ example: 'PERSON_LIST_VIEWED', description: 'Código de la acción (catálogo de auditoría).' }),
    description: z.string().nullable(),
    category: z.string().nullable().meta({ example: 'KYC' }),
    module: z.string().nullable().meta({ example: 'admin', description: 'Origen de la acción: admin | client | system.' }),
    risk: z.enum(RISKS),
    outcome: z.enum(OUTCOMES),
    userId: z.uuid().nullable(),
    sessionId: z.uuid().nullable().meta({ description: 'Sesión desde la que se originó la acción. null en workers/sistema.' }),
    executor: AuditUserRefSchema.nullable().meta({ description: 'Usuario que ejecutó la acción. null si fue el sistema.' }),
    entityId: z.string().nullable().meta({ description: 'ID de la entidad afectada.' }),
    entityType: z.string().nullable().meta({ example: 'Person' }),
    entityTable: z.string().nullable().meta({ example: 'persons' }),
    ip: z.string().nullable(),
    source: z.string().meta({ example: 'http', description: 'http | worker | system | unknown' }),
    createdAt: dateTime()
  })
  .meta({ description: 'Registro de auditoría. Inmutable (append-only).' });

export const AuditLogDetailSchema = AuditLogSchema.extend({
  correlationId: z.string().nullable().meta({ description: 'Operación que lo produjo (ver /audit/operations/{operationId}).' }),
  userAgent: z.string().nullable(),
  fingerprint: z.string().nullable(),
  details: z
    .record(z.string(), z.unknown())
    .nullable()
    .meta({
      description:
        'Datos de la acción (JSON). En actualizaciones trae `before` y `after`. Los datos personales salen enmascarados.'
    })
});

export const AuditAlertSchema = z
  .object({
    alertId: z.uuid(),
    auditLogId: z.uuid().nullable().meta({ description: 'Registro de auditoría que originó la alerta.' }),
    action: z.string().meta({ example: 'RBAC_PERMISSION_GRANTED' }),
    category: z.string().nullable().meta({ example: 'RBAC' }),
    risk: z.enum(RISKS),
    userId: z.uuid().nullable().meta({ description: 'Usuario que realizó la acción.' }),
    user: AuditUserRefSchema.nullable(),
    entityId: z.string().nullable(),
    entityType: z.string().nullable().meta({ example: 'ApprovalRequest' }),
    message: z.string().nullable(),
    acknowledged: z.boolean().meta({ description: 'Si un administrador ya reconoció la alerta.' }),
    acknowledgedBy: z.uuid().nullable(),
    acknowledgedByUser: AuditUserRefSchema.nullable(),
    acknowledgedAt: dateTime().nullable(),
    createdAt: dateTime()
  })
  .meta({ description: 'Alerta generada al registrar una acción de riesgo alto o crítico.' });
