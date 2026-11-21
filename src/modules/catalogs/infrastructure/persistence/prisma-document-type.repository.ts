// Adaptador Prisma del catálogo de tipos de documento.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { PageRequest } from '../../../../shared/application/pagination';
import type {
  CatalogFilters,
  CatalogPage,
  CatalogReader,
  ClientDocumentTypeReader
} from '../../application/ports/catalog-reader.port';
import type { DocumentType } from '../../domain/catalog-entries';
import { CatalogMapper, mapOrNull } from './catalog.mapper';

const LIST = { tiebreaker: 'documentTypeId', searchFields: ['name', 'code'] };

export class PrismaDocumentTypeRepository
  extends PrismaRepository
  implements CatalogReader<DocumentType>, ClientDocumentTypeReader
{
  async list(filters: CatalogFilters, page: PageRequest, search: string | null = null): Promise<CatalogPage<DocumentType>> {
    const { where, page: args } = this.listQuery(filters, page, search, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.documentType.findMany({ where: where as Prisma.DocumentTypeWhereInput, ...args }),
      db.documentType.count({ where: where as Prisma.DocumentTypeWhereInput })
    ]);
    return { rows: rows.map(CatalogMapper.documentType), count };
  }

  /** Los visibles al cliente y activos, por nombre (para el selector del formulario). */
  async listVisibleToClient(): Promise<DocumentType[]> {
    const rows = await (
      await this.db()
    ).documentType.findMany({
      where: { isVisibleToClient: true, isActive: true },
      orderBy: { name: 'asc' }
    });
    return rows.map(CatalogMapper.documentType);
  }

  async findById(documentTypeId: string): Promise<DocumentType | null> {
    return mapOrNull(await (await this.db()).documentType.findUnique({ where: { documentTypeId } }), CatalogMapper.documentType);
  }

  /** Tipo de documento activo por su sigla (p. ej. 'CC'). */
  async findByCode(code: string): Promise<DocumentType | null> {
    return mapOrNull(
      await (await this.db()).documentType.findFirst({ where: { code, isActive: true } }),
      CatalogMapper.documentType
    );
  }
}
