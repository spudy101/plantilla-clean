// ⚠️ TRANSITORIO. Acceso crudo (filas de Prisma) a `system_global_config` para los módulos que todavía no
// están migrados a Clean Architecture y leen columnas que no son de settings:
//   - approvals  → umbrales de doble aprobación (lee)
//   - audit      → retención y purga del caliente (worker audit-archive, lee)
// (banners ya está migrado: lee y escribe su columna promotional_banners con su propio repositorio.)
//
// Cuando cada uno se migre, pedirá lo suyo con un puerto propio y este archivo se borra. Lo nuevo NO lo usa:
// settings trabaja con PrismaSystemGlobalConfigRepository (entidades del dominio).
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { SystemGlobalConfig } from '../../../../shared/infrastructure/database/generated/prisma/client';

class LegacySystemGlobalConfigRepository extends PrismaRepository {
  /** Fila de la configuración global activa (o null si no existe). */
  async findActive(): Promise<SystemGlobalConfig | null> {
    return (await this.db()).systemGlobalConfig.findFirst({ where: { isActive: true } });
  }
}

export default new LegacySystemGlobalConfigRepository();
