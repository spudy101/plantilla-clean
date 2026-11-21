// modules/schemas/kyc/iam/repositories/role-permission-override.repository.ts
//
// Permisos extra por rol (RBAC). origin_session_id lo completa la extensión de Prisma al crear.
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { Prisma, RolePermissionOverride } from '../../../shared/infrastructure/database/generated/prisma/client';

const WITH_GRANTED_BY = {
  grantedBy: { select: { userId: true, username: true, person: { select: { firstName: true, lastName: true } } } }
} satisfies Prisma.RolePermissionOverrideInclude;

export type RolePermissionOverrideWithGrantor = Prisma.RolePermissionOverrideGetPayload<{ include: typeof WITH_GRANTED_BY }>;

class RolePermissionOverrideRepository extends PrismaRepository {
  async findById(rolePermissionId: string): Promise<RolePermissionOverride | null> {
    return (await this.db()).rolePermissionOverride.findUnique({ where: { rolePermissionOverrideId: rolePermissionId } });
  }

  async create(data: Prisma.RolePermissionOverrideUncheckedCreateInput): Promise<RolePermissionOverride> {
    return (await this.db()).rolePermissionOverride.create({ data });
  }

  /** Todos los overrides de un rol con quién los otorgó, ordenados por módulo + acción. */
  async findByRole(roleName: string): Promise<RolePermissionOverrideWithGrantor[]> {
    return (await this.db()).rolePermissionOverride.findMany({
      where: { roleName },
      include: WITH_GRANTED_BY,
      orderBy: [{ moduleName: 'asc' }, { action: 'asc' }]
    });
  }

  /** true si se eliminó un registro. */
  async deleteById(rolePermissionId: string): Promise<boolean> {
    return (await (await this.db()).rolePermissionOverride.deleteMany({ where: { rolePermissionOverrideId: rolePermissionId } })).count > 0;
  }

  /** ¿Ya existe el override exacto? (detección de duplicados). */
  async existsOverride(roleName: string, moduleName: string, action: string): Promise<boolean> {
    return (await (await this.db()).rolePermissionOverride.count({ where: { roleName, moduleName, action } })) > 0;
  }

  /** Solo módulo + acción de un rol (lookup ligero de RbacService). */
  async findLookupByRole(roleName: string): Promise<Array<{ moduleName: string; action: string }>> {
    return (await this.db()).rolePermissionOverride.findMany({ where: { roleName }, select: { moduleName: true, action: true } });
  }
}

export default new RolePermissionOverrideRepository();
