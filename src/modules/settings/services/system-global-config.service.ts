import type { Prisma, SystemGlobalConfig } from '../../../shared/database/generated/prisma/client';
import type { AdminAuditContext } from '../../../shared/types/audit-context';
import AppError from '../../../shared/http/app-error.util';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import systemGlobalConfigRepository from '../repositories/system-global-config.repository';
import systemGlobalConfigDtoModule from '../responses/system-global-config.response';
const { SystemGlobalConfigDTO } = systemGlobalConfigDtoModule;
import notificationModule from '../../notification';
const { notifier } = notificationModule;
import auditModule from '../../audit';
const { audit } = auditModule;

const NOTIF_SYSTEM_CONFIG_UPDATED = 'SYSTEM_CONFIG_UPDATED_INTERNAL';

class SystemGlobalConfigService {
  notifier: typeof notifier;
  systemGlobalConfigRepository: typeof systemGlobalConfigRepository;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new SystemGlobalConfigService({ notifier: fake })
   * @param {object} [deps]
   */
  constructor(deps: SystemGlobalConfigService.Deps = {}) {
    this.notifier = deps.notifier ?? notifier;
    this.systemGlobalConfigRepository = deps.systemGlobalConfigRepository ?? systemGlobalConfigRepository;
  }

  async getConfig(adminUserId: string) {
    const config = await this.systemGlobalConfigRepository.findActive();
    if (!config) {
      throw AppError.notFound('No hay una configuración global activa. Contacta al equipo de infraestructura.');
    }

    await audit.record('SYSTEM_GLOBAL_CONFIG_VIEWED', {
      actorId: adminUserId,
      entityId: config.systemGlobalConfigId,
      entityType: 'SystemGlobalConfig',
      entityTable: 'system_global_config'
    });

    return SystemGlobalConfigDTO(config);
  }

  async updateConfig(data: SystemGlobalConfigService.UpdateInput, adminUserId: string, _auditCtx?: AdminAuditContext) {
    let config = await this.systemGlobalConfigRepository.findActive();

    if (!config) {
      logger.warn('SystemGlobalConfigService.update — no existe config activa, creando con defaults');
      config = await this.systemGlobalConfigRepository.createActive();
    }

    const updatePayload = _buildUpdatePayload(data, config);
    const previousVersion = config.configVersion;

    const updated = await this.systemGlobalConfigRepository.update(config.systemGlobalConfigId, updatePayload);
    if (!updated) {
      throw AppError.notFound('Configuración global no encontrada');
    }

    await audit.record('SYSTEM_GLOBAL_CONFIG_UPDATED', {
      actorId: adminUserId,
      details: {
        updatedFields: Object.keys(data),
        configVersion: { before: previousVersion, after: updated.configVersion }
      },
      entityId: config.systemGlobalConfigId,
      entityType: 'SystemGlobalConfig',
      entityTable: 'system_global_config'
    });

    setImmediate(() => {
      this.notifier
        .notify({
          type: NOTIF_SYSTEM_CONFIG_UPDATED,
          userId: null,
          relatedEntity: { type: 'SystemGlobalConfig', id: config.systemGlobalConfigId },
          metadata: {
            camposActualizados: Object.keys(data),
            versionAnterior: previousVersion,
            versionNueva: updated.configVersion,
            adminUserId
          }
        })
        .catch(err => logger.warn('Error notificando actualización de config global', { error: err.message }));
    });

    logger.info('SystemGlobalConfigService.update', {
      adminUserId,
      fields: Object.keys(data),
      newVersion: updated.configVersion
    });

    return SystemGlobalConfigDTO(updated);
  }
}

function _buildUpdatePayload(data: SystemGlobalConfigService.UpdateInput, current: SystemGlobalConfig) {
  const payload: Prisma.SystemGlobalConfigUpdateManyMutationInput = { configVersion: { increment: 1 } };

  if (data.currency !== undefined) {
    payload.currency = data.currency;
  }
  if (data.auditRetentionHotYears !== undefined) {
    payload.auditRetentionHotYears = data.auditRetentionHotYears;
  }
  if (data.auditRetentionColdYears !== undefined) {
    payload.auditRetentionColdYears = data.auditRetentionColdYears;
  }
  if (data.auditHotPurgeEnabled !== undefined) {
    payload.auditHotPurgeEnabled = data.auditHotPurgeEnabled;
  }
  if (data.integrationResilience !== undefined) {
    payload.integrationResilience = _mergeResilience(current.integrationResilience as StoredResilience | null, data.integrationResilience) as Prisma.InputJsonValue;
  }

  return payload;
}

// integration_resilience se persiste en snake_case (con circuit_breaker anidado). Merge parcial:
// convierte los camelCase entrantes a snake_case y conserva lo no enviado (incluye el sub-objeto
// circuit_breaker campo a campo). Mismo criterio de edición que integraciones.
/** integration_resilience tal como se guarda (JSONB, snake_case). */
interface StoredResilience {
  timeout_ms?: number;
  max_retries?: number;
  circuit_breaker?: { failure_threshold?: number; recovery_time_ms?: number; failures_ttl_s?: number };
}

function _mergeResilience(current: StoredResilience | null | undefined, incoming: SystemGlobalConfigService.ResilienceInput): StoredResilience {
  const base = current ?? {};
  const merged: StoredResilience = { ...base };

  if (incoming.timeoutMs !== undefined) {
    merged.timeout_ms = incoming.timeoutMs;
  }
  if (incoming.maxRetries !== undefined) {
    merged.max_retries = incoming.maxRetries;
  }

  if (incoming.circuitBreaker !== undefined) {
    const baseCb = base.circuit_breaker ?? {};
    const cb: NonNullable<StoredResilience['circuit_breaker']> = { ...baseCb };
    if (incoming.circuitBreaker.failureThreshold !== undefined) {
      cb.failure_threshold = incoming.circuitBreaker.failureThreshold;
    }
    if (incoming.circuitBreaker.recoveryTimeMs !== undefined) {
      cb.recovery_time_ms = incoming.circuitBreaker.recoveryTimeMs;
    }
    if (incoming.circuitBreaker.failuresTtlS !== undefined) {
      cb.failures_ttl_s = incoming.circuitBreaker.failuresTtlS;
    }
    merged.circuit_breaker = cb;
  }

  return merged;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace SystemGlobalConfigService {
  /** integration_resilience tal como lo manda el panel (camelCase, todo opcional: merge parcial). */
  export interface ResilienceInput {
    timeoutMs?: number;
    maxRetries?: number;
    circuitBreaker?: { failureThreshold?: number; recoveryTimeMs?: number; failuresTtlS?: number };
  }

  export interface UpdateInput {
    currency?: string;
    auditRetentionHotYears?: number;
    auditRetentionColdYears?: number;
    auditHotPurgeEnabled?: boolean;
    integrationResilience?: ResilienceInput;
  }

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    notifier?: typeof notifier;
    systemGlobalConfigRepository?: typeof systemGlobalConfigRepository;
  }
}

export default Object.assign(new SystemGlobalConfigService(), { SystemGlobalConfigService });
