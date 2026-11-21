// Caso de uso: leer la política de resiliencia vigente. Lo usa la infraestructura compartida
// (callProvider y el circuit breaker) a través del punto de registro que conecta src/main/.
import type { SystemGlobalConfigRepository } from '../ports/system-global-config-repository.port';
import type { IntegrationResilienceProps } from '../../domain/integration-resilience';

export class GetIntegrationResilience {
  constructor(private readonly configs: SystemGlobalConfigRepository) {}

  /** La política configurada, o null si no hay configuración activa (quien consume usa sus defaults). */
  async execute(): Promise<IntegrationResilienceProps | null> {
    const config = await this.configs.findActive();
    return config ? config.integrationResilience.toProps() : null;
  }
}
