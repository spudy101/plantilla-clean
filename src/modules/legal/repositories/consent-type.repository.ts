// modules/schemas/records/legal/repositories/consent-type.repository.ts
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../shared/application/pagination';
import { Prisma } from '../../../shared/infrastructure/database/generated/prisma/client';
import type { ConsentType } from '../../../shared/infrastructure/database/generated/prisma/client';

const LIST = { tiebreaker: 'consentTypeId', searchFields: ['name', 'code', 'description'] };

class ConsentTypeRepository extends PrismaRepository {
  async findById(consentTypeId: string): Promise<ConsentType | null> {
    return (await this.db()).consentType.findUnique({ where: { consentTypeId } });
  }

  /** Tipo activo por código (los inactivos no se pueden otorgar ni exigir). */
  async findByCode(code: string): Promise<ConsentType | null> {
    return (await this.db()).consentType.findFirst({ where: { code, isActive: true } });
  }

  /** Por código, activo o no (unicidad al crear). */
  async findAnyByCode(code: string): Promise<ConsentType | null> {
    return (await this.db()).consentType.findUnique({ where: { code } });
  }

  async findAllActive(): Promise<ConsentType[]> {
    return (await this.db()).consentType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }

  async findAllPaginated(
    filters: PrismaRepository.Filters = {},
    pagination: PageRequest,
    searchTerm: string | null = null
  ): Promise<PrismaRepository.Page<ConsentType>> {
    const { where, page } = this.listQuery(filters, pagination, searchTerm, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.consentType.findMany({ where: where as Prisma.ConsentTypeWhereInput, ...page }),
      db.consentType.count({ where: where as Prisma.ConsentTypeWhereInput })
    ]);
    return { rows, count };
  }

  async create(data: Prisma.ConsentTypeUncheckedCreateInput): Promise<ConsentType> {
    return (await this.db()).consentType.create({ data });
  }

  /** null si la fila ya no existe (mismo contrato que BaseRepository#update). */
  async update(consentTypeId: string, data: Prisma.ConsentTypeUncheckedUpdateManyInput): Promise<ConsentType | null> {
    const [row] = await (await this.db()).consentType.updateManyAndReturn({ where: { consentTypeId }, data });
    return row ?? null;
  }
}

export default new ConsentTypeRepository();
