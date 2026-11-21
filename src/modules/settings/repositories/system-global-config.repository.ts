// modules/schemas/core/repositories/system-global-config.repository.ts
//
// Acceso a `system_global_config` (una sola fila activa). Los JSON (integration_resilience,
// promotional_banners) se guardan tal cual, en snake_case: son datos, no columnas.
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { Prisma, SystemGlobalConfig } from '../../../shared/database/generated/prisma/client';

class SystemGlobalConfigRepository extends PrismaRepository {
  /** Configuración global activa (o null si no existe). */
  async findActive(): Promise<SystemGlobalConfig | null> {
    return (await this.db()).systemGlobalConfig.findFirst({ where: { isActive: true } });
  }

  /** Solo la configuración de resiliencia de integraciones de la global activa. */
  async findActiveResilience(): Promise<Pick<SystemGlobalConfig, 'integrationResilience'> | null> {
    return (await this.db()).systemGlobalConfig.findFirst({ where: { isActive: true }, select: { integrationResilience: true } });
  }

  /** Crea una configuración activa con los valores por defecto (origen de sesión: extensión de Prisma). */
  async createActive(): Promise<SystemGlobalConfig> {
    return (await this.db()).systemGlobalConfig.create({ data: { isActive: true } });
  }

  /** null si la fila ya no existe. */
  async update(configId: string, data: Prisma.SystemGlobalConfigUpdateManyMutationInput): Promise<SystemGlobalConfig | null> {
    const [row] = await (await this.db()).systemGlobalConfig.updateManyAndReturn({ where: { systemGlobalConfigId: configId }, data });
    return row ?? null;
  }
}

export default new SystemGlobalConfigRepository();
