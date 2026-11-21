// modules/schemas/kyc/maintainers/repositories/document-type.repository.ts
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../shared/application/pagination';
import { Prisma } from '../../../shared/infrastructure/database/generated/prisma/client';
import type { DocumentType } from '../../../shared/infrastructure/database/generated/prisma/client';

const LIST = { tiebreaker: 'documentTypeId', searchFields: ['name', 'code'] };

class DocumentTypeRepository extends PrismaRepository {
  async findById(documentTypeId: string): Promise<DocumentType | null> {
    return (await this.db()).documentType.findUnique({ where: { documentTypeId } });
  }

  /**
   * Busca un tipo de documento activo por su sigla (code)
   * @param {string} code - Ej: 'CC', 'CE', 'TI'
   */
  async findByCode(code: string): Promise<DocumentType | null> {
    return (await this.db()).documentType.findFirst({ where: { code, isActive: true } });
  }

  /** Lista solo los tipos visibles al cliente (para el selector del formulario). */
  async findAllVisibleToClient(): Promise<DocumentType[]> {
    return (await this.db()).documentType.findMany({ where: { isVisibleToClient: true, isActive: true }, orderBy: { name: 'asc' } });
  }

  async findAllPaginated(
    filters: PrismaRepository.Filters = {},
    pagination: PageRequest,
    searchTerm: string | null = null
  ): Promise<PrismaRepository.Page<DocumentType>> {
    const { where, page } = this.listQuery(filters, pagination, searchTerm, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.documentType.findMany({ where: where as Prisma.DocumentTypeWhereInput, ...page }),
      db.documentType.count({ where: where as Prisma.DocumentTypeWhereInput })
    ]);
    return { rows, count };
  }
}

export default new DocumentTypeRepository();
