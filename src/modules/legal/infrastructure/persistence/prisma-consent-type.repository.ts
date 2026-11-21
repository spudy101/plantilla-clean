// Adaptador Prisma del puerto ConsentTypeRepository.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { ConsentTypePage, ConsentTypeRepository } from '../../application/ports/consent-type-repository.port';
import type { ConsentType, ConsentTypeChanges, NewConsentType } from '../../domain/consent-type';
import { LegalMapper } from './legal.mapper';

const LIST = { tiebreaker: 'consentTypeId', searchFields: ['name', 'code', 'description'] };
const toDomain = LegalMapper.consentTypeToDomain;

export class PrismaConsentTypeRepository extends PrismaRepository implements ConsentTypeRepository {
  async findById(consentTypeId: string): Promise<ConsentType | null> {
    const row = await (await this.db()).consentType.findUnique({ where: { consentTypeId } });
    return row ? toDomain(row) : null;
  }

  async findActiveByCode(code: string): Promise<ConsentType | null> {
    const row = await (await this.db()).consentType.findFirst({ where: { code, isActive: true } });
    return row ? toDomain(row) : null;
  }

  async existsWithCode(code: string): Promise<boolean> {
    return (await (await this.db()).consentType.findUnique({ where: { code }, select: { consentTypeId: true } })) !== null;
  }

  async listActive(): Promise<ConsentType[]> {
    const rows = await (await this.db()).consentType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    return rows.map(toDomain);
  }

  async list(pagination: PageRequest, search: string | null): Promise<ConsentTypePage> {
    const { where, page } = this.listQuery({}, pagination, search, LIST);
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.consentType.findMany({ where: where as Prisma.ConsentTypeWhereInput, ...page }),
      db.consentType.count({ where: where as Prisma.ConsentTypeWhereInput })
    ]);
    return { rows: rows.map(toDomain), count };
  }

  async create(consentType: NewConsentType): Promise<ConsentType> {
    return toDomain(await (await this.db()).consentType.create({ data: consentType }));
  }

  async update(consentTypeId: string, changes: ConsentTypeChanges): Promise<ConsentType | null> {
    const [row] = await (await this.db()).consentType.updateManyAndReturn({ where: { consentTypeId }, data: changes });
    return row ? toDomain(row) : null;
  }
}
