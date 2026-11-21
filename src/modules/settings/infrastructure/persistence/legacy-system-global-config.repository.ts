// ⚠️ TRANSITORIO. Acceso crudo (filas de Prisma) a `system_global_config` para los módulos que todavía no
// están migrados a Clean Architecture y leen columnas que no son de settings:
//   - banners    → promotional_banners (lee y escribe)
//   - approvals  → umbrales de doble aprobación (lee)
//   - audit      → retención y purga del caliente (worker audit-archive, lee)
//
// Cuando cada uno se migre, pedirá lo suyo con un puerto propio y este archivo se borra. Lo nuevo NO lo usa:
// settings trabaja con PrismaSystemGlobalConfigRepository (entidades del dominio).
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { Prisma, SystemGlobalConfig } from '../../../../shared/infrastructure/database/generated/prisma/client';

class LegacySystemGlobalConfigRepository extends PrismaRepository {
  /** Fila de la configuración global activa (o null si no existe). */
  async findActive(): Promise<SystemGlobalConfig | null> {
    return (await this.db()).systemGlobalConfig.findFirst({ where: { isActive: true } });
  }

  /** null si la fila ya no existe. */
  async update(configId: string, data: Prisma.SystemGlobalConfigUpdateManyMutationInput): Promise<SystemGlobalConfig | null> {
    const [row] = await (
      await this.db()
    ).systemGlobalConfig.updateManyAndReturn({ where: { systemGlobalConfigId: configId }, data });
    return row ?? null;
  }
}

export default new LegacySystemGlobalConfigRepository();
