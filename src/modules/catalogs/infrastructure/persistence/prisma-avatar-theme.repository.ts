// Adaptador Prisma del catálogo de temas de avatar.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { CatalogFilters, CatalogPage, CatalogReader } from '../../application/ports/catalog-reader.port';
import type { AvatarTheme } from '../../domain/catalog-entries';
import { CatalogMapper } from './catalog.mapper';

const LIST = { tiebreaker: 'avatarThemeId', searchFields: ['name'] };

export class PrismaAvatarThemeRepository extends PrismaRepository implements CatalogReader<AvatarTheme> {
  async list(filters: CatalogFilters, page: PageRequest, search: string | null = null): Promise<CatalogPage<AvatarTheme>> {
    const { where, page: args } = this.listQuery(filters, page, search, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.avatarTheme.findMany({ where: where as Prisma.AvatarThemeWhereInput, ...args }),
      db.avatarTheme.count({ where: where as Prisma.AvatarThemeWhereInput })
    ]);
    return { rows: rows.map(CatalogMapper.avatarTheme), count };
  }
}
