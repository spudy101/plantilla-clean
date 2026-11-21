// Caso de uso: un administrador consulta la configuración global (y queda auditado).
//
// Recibe todo lo que necesita por constructor, como puertos (interfaces). No sabe qué base, qué módulo
// de auditoría ni qué framework HTTP hay detrás: eso lo conecta settings.module.ts.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { SystemGlobalConfigRepository } from '../ports/system-global-config-repository.port';
import { ActiveConfigNotFoundError } from '../../domain/errors';
import { toSystemGlobalConfigOutput, type SystemGlobalConfigOutput } from '../dto/system-global-config.output';

export interface GetSystemGlobalConfigInput {
  actorId: string;
}

export class GetSystemGlobalConfig {
  constructor(
    private readonly configs: SystemGlobalConfigRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId }: GetSystemGlobalConfigInput): Promise<SystemGlobalConfigOutput> {
    const config = await this.configs.findActive();
    if (!config) {
      throw new ActiveConfigNotFoundError();
    }

    await this.audit.record('SYSTEM_GLOBAL_CONFIG_VIEWED', {
      actorId,
      entityId: config.id,
      entityType: 'SystemGlobalConfig',
      entityTable: 'system_global_config'
    });

    return toSystemGlobalConfigOutput(config);
  }
}
