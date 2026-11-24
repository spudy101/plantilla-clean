// Adaptador Prisma del puerto PersonReferenceRepository (borrado lógico con is_active).
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { PersonReferenceRepository } from '../../application/ports/person-reference-repository.port';
import type { PersonReference, ReferenceData } from '../../domain/person-reference';
import { PersonMapper } from './person.mapper';

const toDomain = PersonMapper.referenceToDomain;

export class PrismaPersonReferenceRepository extends PrismaRepository implements PersonReferenceRepository {
  async listActive(personId: string): Promise<PersonReference[]> {
    const rows = await (await this.db()).personReference.findMany({ where: { personId, isActive: true }, orderBy: { createdAt: 'asc' } });
    return rows.map(toDomain);
  }

  async findActive(personReferenceId: string, personId: string): Promise<PersonReference | null> {
    const row = await (await this.db()).personReference.findFirst({ where: { personReferenceId, personId, isActive: true } });
    return row ? toDomain(row) : null;
  }

  async create(personId: string, data: ReferenceData): Promise<PersonReference> {
    return toDomain(await (await this.db()).personReference.create({ data: { personId, ...data } }));
  }

  async update(personReferenceId: string, changes: Partial<ReferenceData>): Promise<PersonReference | null> {
    const [row] = await (await this.db()).personReference.updateManyAndReturn({ where: { personReferenceId }, data: changes });
    return row ? toDomain(row) : null;
  }

  async deactivate(personReferenceId: string): Promise<void> {
    await (await this.db()).personReference.updateMany({ where: { personReferenceId }, data: { isActive: false } });
  }
}
