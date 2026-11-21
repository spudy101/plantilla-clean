// modules/schemas/kyc/maintainers/repositories/avatar.repository.ts
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../shared/application/pagination';
import { Prisma } from '../../../shared/infrastructure/database/generated/prisma/client';
import type { Avatar } from '../../../shared/infrastructure/database/generated/prisma/client';

const LIST = {
  tiebreaker: 'avatarId',
  searchFields: ['name'],
  filterId: { key: 'themeId', field: 'avatarThemeId' }
};
// Mismo include por defecto que en Sequelize: el tema (id, nombre)
const WITH_THEME = { theme: { select: { avatarThemeId: true, name: true } } } satisfies Prisma.AvatarInclude;

class AvatarRepository extends PrismaRepository {
  async findById(avatarId: string): Promise<Avatar | null> {
    return (await this.db()).avatar.findUnique({ where: { avatarId } });
  }

  async findAllPaginated(
    filters: PrismaRepository.Filters = {},
    pagination: PageRequest,
    searchTerm: string | null = null
  ) {
    const { where, page } = this.listQuery(filters, pagination, searchTerm, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.avatar.findMany({ where: where as Prisma.AvatarWhereInput, include: WITH_THEME, ...page }),
      db.avatar.count({ where: where as Prisma.AvatarWhereInput })
    ]);
    return { rows, count };
  }
}

export default new AvatarRepository();
