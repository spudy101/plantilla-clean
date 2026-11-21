// modules/schemas/kyc/maintainers/repositories/avatar-theme.repository.ts
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { PageRequest } from '../../../shared/http/pagination';
import { Prisma } from '../../../shared/database/generated/prisma/client';
import type { AvatarTheme } from '../../../shared/database/generated/prisma/client';

const LIST = { tiebreaker: 'avatarThemeId', searchFields: ['name'] };

class AvatarThemeRepository extends PrismaRepository {
  async findAllPaginated(
    filters: PrismaRepository.Filters = {},
    pagination: PageRequest,
    searchTerm: string | null = null
  ): Promise<PrismaRepository.Page<AvatarTheme>> {
    const { where, page } = this.listQuery(filters, pagination, searchTerm, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.avatarTheme.findMany({ where: where as Prisma.AvatarThemeWhereInput, ...page }),
      db.avatarTheme.count({ where: where as Prisma.AvatarThemeWhereInput })
    ]);
    return { rows, count };
  }
}

export default new AvatarThemeRepository();
