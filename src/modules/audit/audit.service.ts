// modules/audit/audit.service.ts
//
// ÚNICA puerta para registrar un hecho de negocio:
//
//   await audit.record('PERSON_ROLE_CHANGED', {
//     actorId: adminUserId,
//     entityType: 'User', entityTable: 'users', entityId: userId,
//     details: { before: { role: 'a' }, after: { role: 'b' } }
//   });
//
// - La acción es una clave del catálogo (./catalog): un typo no compila.
// - Quién, desde dónde y en qué operación (ip, user-agent, sesión, correlationId) sale solo del
//   contexto de la operación en curso.
// - Se escribe DENTRO de la transacción en curso: el cambio y su auditoría quedan juntos o ninguno.
//   Los intentos fallidos (outcome ≠ success) se escriben aparte, porque esa transacción se va a revertir
//   y el intento tiene que quedar.
// - Si la acción tiene `alert: true` en el catálogo, crea también su alerta para el Superadmin.
// - S3 no se escribe aquí: el worker de archivado exporta los registros por lotes diarios.
import requestContext from '../../shared/infrastructure/observability/request-context.util';
import txContext from '../../shared/infrastructure/database/transaction-context';
import loggerUtilModule from '../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import errorMessageModule from '../../shared/kernel/error-message.util';
const { errorMessage } = errorMessageModule;
import type { AuditLogOutcome, AuditLogRisk, Prisma } from '../../shared/infrastructure/database/generated/prisma/client';
import auditLogRepository from './repositories/audit-log.repository';
import auditAlertRepository from './repositories/audit-alert.repository';
import catalogModule, { type AuditActionDef, type AuditActionKey } from './catalog';
const { AUDIT_ACTIONS } = catalogModule;

export interface AuditRecordInput {
  /** Usuario que ejecuta la acción; 'system' (o null) para procesos automáticos o rutas públicas. */
  actorId: string | null | undefined;
  details?: Record<string, unknown>;
  outcome?: AuditLogOutcome;
  entityId?: string | null;
  entityType?: string | null;
  entityTable?: string | null;
}

/** Campos de la cuenta cuyo cambio queda en la bitácora. */
export type ChangeType =
  | 'email' | 'password' | 'mfa_status' | 'account_status' | 'role' | 'national_id' | 'name' | 'gender'
  | 'location' | 'phone' | 'birth_date' | 'funds_origin' | 'sms_mfa_status' | 'preferred_mfa_method';
export type ChangedByRole = 'admin' | 'user' | 'system';

/** Un cambio sobre la cuenta `userId` (USER_FIELD_CHANGED). previousValue/newValue se enmascaran al responder. */
export interface ChangeInput {
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

type AuditLogWriter = Pick<typeof auditLogRepository, 'create'>;
type AuditAlertWriter = Pick<typeof auditAlertRepository, 'create'>;

const UUID_REGEX = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
// 'system' u otros ids no-UUID no van a la FK users.user_id
const asUserId = (id: string | null | undefined): string | null => (id && UUID_REGEX.test(id) ? id : null);

const UNKNOWN_ACTION: AuditActionDef = { description: '', category: 'Sin categoría', risk: 'unknown' };

class AuditService {
  auditLogRepository: AuditLogWriter;
  auditAlertRepository: AuditAlertWriter;

  constructor(deps: AuditService.Deps = {}) {
    this.auditLogRepository = deps.auditLogRepository ?? auditLogRepository;
    this.auditAlertRepository = deps.auditAlertRepository ?? auditAlertRepository;
  }

  /** La definición de una acción del catálogo. */
  definition(action: string): AuditActionDef {
    return (AUDIT_ACTIONS as Record<string, AuditActionDef | undefined>)[action] ?? { ...UNKNOWN_ACTION, description: action };
  }

  /** Bitácora de cambios: un USER_FIELD_CHANGED sobre la cuenta, con el valor anterior y el nuevo. */
  recordChange(change: ChangeInput): Promise<void> {
    return this.record('USER_FIELD_CHANGED', {
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
    });
  }

  async record(action: AuditActionKey, input: AuditRecordInput): Promise<void> {
    const def = this.definition(action);
    const ctx = requestContext.getSafe();
    const outcome = input.outcome ?? 'success';
    const independent = outcome !== 'success';
    const inTransaction = !independent && txContext.activeUnit() !== null;

    try {
      const log = await this.auditLogRepository.create(
        {
          action,
          description: def.description,
          category: def.category,
          risk: def.risk as AuditLogRisk,
          module: def.module ?? null,
          outcome,
          userId: asUserId(input.actorId ?? ctx.userId),
          sessionId: ctx.sessionId ?? null,
          correlationId: ctx.correlationId,
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent,
          fingerprint: ctx.fingerprintHash,
          source: ctx.source,
          details: (input.details ?? {}) as Prisma.InputJsonValue,
          entityId: input.entityId ?? null,
          entityType: input.entityType ?? null,
          entityTable: input.entityTable ?? null
        },
        { independent }
      );

      if (def.alert) {
        await this.auditAlertRepository.create(
          {
            auditLogId: log.auditLogId,
            action,
            category: def.category,
            risk: def.risk as AuditLogRisk,
            userId: log.userId,
            entityId: log.entityId,
            entityType: log.entityType,
            message: def.description || action
          },
          { independent }
        );
      }
      logger.debug('audit', { action, outcome, correlationId: ctx.correlationId });
    } catch (error) {
      // Dentro de una transacción el fallo la revierte (el cambio no queda sin su auditoría). Fuera de
      // ella el cambio ya está hecho: se reporta y se sigue.
      if (inTransaction) {
        throw error;
      }
      logger.error('No se pudo registrar la auditoría', { action, correlationId: ctx.correlationId, error: errorMessage(error) });
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace AuditService {
  interface Deps {
    auditLogRepository?: AuditLogWriter;
    auditAlertRepository?: AuditAlertWriter;
  }
}

export type { AuditActionKey };
export default Object.assign(new AuditService(), { AuditService });
