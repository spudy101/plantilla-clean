// modules/schemas/kyc/person/repositories/person-reference.repository.ts
//
// Referencias personales (borrado lógico con is_active).
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { PersonReference, Prisma } from '../../../shared/database/generated/prisma/client';

class PersonReferenceRepository extends PrismaRepository {
  async findAllByPersonId(personId: string): Promise<PersonReference[]> {
    return (await this.db()).personReference.findMany({ where: { personId, isActive: true }, orderBy: { createdAt: 'asc' } });
  }

  async findActiveById(personReferenceId: string, personId: string): Promise<PersonReference | null> {
    return (await this.db()).personReference.findFirst({ where: { personReferenceId, personId, isActive: true } });
  }

  async create(data: Prisma.PersonReferenceUncheckedCreateInput): Promise<PersonReference> {
    return (await this.db()).personReference.create({ data });
  }

  /** Actualiza por id; null si la fila no existe. */
  async update(personReferenceId: string, data: Prisma.PersonReferenceUncheckedUpdateManyInput): Promise<PersonReference | null> {
    const [row] = await (await this.db()).personReference.updateManyAndReturn({ where: { personReferenceId }, data });
    return row ?? null;
  }
}

export default new PersonReferenceRepository();
