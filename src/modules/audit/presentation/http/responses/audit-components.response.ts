// Esquemas de salida de registros, alertas y bitácora de cambios. Describen (y documentan en Swagger) lo que
// devuelven los casos de uso (application/dto/audit-log.output.ts).
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';
import { AUDIT_TAXONOMY } from '../../../application/dto/audit-taxonomy.output';

const RISKS = [...AUDIT_TAXONOMY.risks, 'unknown'] as [string, ...string[]];
const OUTCOMES = AUDIT_TAXONOMY.outcomes;

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

export const AlertsAcknowledgedSchema = z.object({
  acknowledged: z.number().int().meta({ example: 3, description: 'Alertas que se marcaron como reconocidas.' }),
  requested: z.number().int().meta({ example: 3, description: 'Alertas enviadas en la petición.' })
});

/** Usuario de la bitácora y de las sesiones (mismo contrato que el resto de la API). */
const UserRefSchema = z.object({
  userId: z.uuid(),
  username: z.string().nullish().meta({ example: 'jdoe' }),
  fullName: z.string().nullable().meta({ example: 'John Doe' })
});

export const ChangeLogSchema = z
  .object({
    logId: z.uuid(),
    userId: z.uuid().nullable().meta({ description: 'Usuario afectado por el cambio.' }),
    user: UserRefSchema.nullable(),
    changedByUserId: z.uuid().nullable().meta({ description: 'Usuario que hizo el cambio.' }),
    changedByRole: z.string().meta({ example: 'admin', description: 'user | admin | system' }),
    changedBy: UserRefSchema.nullable().meta({ description: 'null si lo hizo el sistema.' }),
    changeType: z.string().meta({ example: 'email', description: 'Campo o entidad que cambió.' }),
    previousValue: z
      .string()
      .nullable()
      .meta({ description: 'Valor anterior. Correos, documentos y teléfonos salen enmascarados; contraseñas como `hidden`.' }),
    newValue: z.string().nullable().meta({ description: 'Valor nuevo. Mismo enmascaramiento que `previousValue`.' }),
    changeReason: z.string().nullable(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    originSessionId: z.uuid().nullable().meta({ description: 'Sesión desde la que se hizo. null si fue un worker.' }),
    createdAt: dateTime()
  })
  .meta({ description: 'Cambio sobre los datos de una cuenta (vista sobre audit_logs).' });

export const UserSessionSchema = z.object({
  sessionId: z.uuid(),
  status: z.string().meta({ example: 'active', description: 'active | closed' }),
  ipAddress: z.string().nullable().meta({ example: '190.114.45.227' }),
  userAgent: z.string().nullable(),
  startedAt: dateTime(),
  lastAccessAt: dateTime(),
  closedAt: dateTime().nullable(),
  closeReason: z.string().nullable().meta({ example: 'revoked_by_admin' }),
  createdAt: dateTime(),
  user: UserRefSchema.nullable()
});
