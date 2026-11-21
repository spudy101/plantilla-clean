// Adaptador Prisma del catálogo de avatares (con su tema).
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { CatalogFilters, CatalogPage, CatalogReader } from '../../application/ports/catalog-reader.port';
import type { Avatar } from '../../domain/catalog-entries';
import { CatalogMapper, mapOrNull } from './catalog.mapper';

const LIST = { tiebreaker: 'avatarId', searchFields: ['name'], filterId: { key: 'themeId', field: 'avatarThemeId' } };
const WITH_THEME = { theme: { select: { avatarThemeId: true, name: true } } } satisfies Prisma.AvatarInclude;

export class PrismaAvatarRepository extends PrismaRepository implements CatalogReader<Avatar> {
  async list(filters: CatalogFilters, page: PageRequest, search: string | null = null): Promise<CatalogPage<Avatar>> {
    const { where, page: args } = this.listQuery(filters, page, search, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.avatar.findMany({ where: where as Prisma.AvatarWhereInput, include: WITH_THEME, ...args }),
      db.avatar.count({ where: where as Prisma.AvatarWhereInput })
    ]);
    return { rows: rows.map(CatalogMapper.avatar), count };
  }

  async findById(avatarId: string): Promise<Avatar | null> {
    return mapOrNull(await (await this.db()).avatar.findUnique({ where: { avatarId } }), CatalogMapper.avatar);
  }
}
