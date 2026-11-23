// Caso de uso: leer la política de retención de la auditoría vigente. Lo usa el worker de retención de audit
// a través de src/main/adapters/audit-retention.adapter.ts. No se audita: es una lectura del sistema.
import type { SystemGlobalConfigRepository } from '../ports/system-global-config-repository.port';
import type { AuditRetention } from '../../domain/system-global-config';

export class GetAuditRetention {
  constructor(private readonly configs: SystemGlobalConfigRepository) {}

  /** La política configurada, o null si no hay configuración activa (quien consume usa sus defaults). */
  async execute(): Promise<AuditRetention | null> {
    const config = await this.configs.findActive();
    return config ? { ...config.auditRetention } : null;
  }
}
