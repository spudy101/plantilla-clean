// Adaptador: implementa el puerto SystemGlobalConfigRepository (application/ports) con Prisma.
// Recibe y devuelve entidades; la traducción fila ↔ entidad la hace el mapper.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { SystemGlobalConfigRepository } from '../../application/ports/system-global-config-repository.port';
import type { SystemGlobalConfig, SystemGlobalConfigChanges } from '../../domain/system-global-config';
import { SystemGlobalConfigMapper, SYSTEM_GLOBAL_CONFIG_COLUMNS } from './system-global-config.mapper';

export class PrismaSystemGlobalConfigRepository extends PrismaRepository implements SystemGlobalConfigRepository {
  async findActive(): Promise<SystemGlobalConfig | null> {
    const row = await (
      await this.db()
    ).systemGlobalConfig.findFirst({ where: { isActive: true }, select: SYSTEM_GLOBAL_CONFIG_COLUMNS });
    return row ? SystemGlobalConfigMapper.toDomain(row) : null;
  }

  async createDefault(): Promise<SystemGlobalConfig> {
    // Los valores por defecto los pone la base (DEFAULT de cada columna)
    const row = await (
      await this.db()
    ).systemGlobalConfig.create({ data: { isActive: true }, select: SYSTEM_GLOBAL_CONFIG_COLUMNS });
    return SystemGlobalConfigMapper.toDomain(row);
  }

  async applyChanges(configId: string, changes: SystemGlobalConfigChanges): Promise<SystemGlobalConfig | null> {
    const [row] = await (
      await this.db()
    ).systemGlobalConfig.updateManyAndReturn({
      where: { systemGlobalConfigId: configId },
      data: SystemGlobalConfigMapper.toUpdate(changes),
      select: SYSTEM_GLOBAL_CONFIG_COLUMNS
    });
    return row ? SystemGlobalConfigMapper.toDomain(row) : null;
  }
}
