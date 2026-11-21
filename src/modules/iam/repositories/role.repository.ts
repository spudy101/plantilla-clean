// modules/schemas/kyc/iam/repositories/role.repository.ts
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../shared/application/pagination';
import { Prisma } from '../../../shared/infrastructure/database/generated/prisma/client';
import type { Role } from '../../../shared/infrastructure/database/generated/prisma/client';

const SEARCH_FIELDS = ['name', 'description'];

class RoleRepository extends PrismaRepository {
  /** Listado paginado del catálogo (mismo contrato que ReadRepository#findAllPaginated). */
  async findAllPaginated(
    filters: PrismaRepository.Filters = {},
    pagination: PageRequest,
    searchTerm: string | null = null
  ): Promise<PrismaRepository.Page<Role>> {
    const where: Prisma.RoleWhereInput = {
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...this.searchWhere(searchTerm, SEARCH_FIELDS)
    };
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.role.findMany({ where, ...this.paginationArgs(pagination, 'roleId') }),
      db.role.count({ where })
    ]);
    return { rows, count };
  }

  async findById(roleId: string): Promise<Role | null> {
    return (await this.db()).role.findUnique({ where: { roleId } });
  }

  async findByName(name: string): Promise<Role | null> {
    return (await this.db()).role.findUnique({ where: { name } });
  }

  /** Roles cuyo nombre está en `names`, opcionalmente excluyendo `exclude`. */
  async findByNames(names: readonly string[], { exclude = [] }: { exclude?: readonly string[] } = {}): Promise<Role[]> {
    return (await this.db()).role.findMany({
      where: { name: { in: [...names], ...(exclude.length ? { notIn: [...exclude] } : {}) } }
    });
  }
}

export default new RoleRepository();
