// modules/schemas/kyc/person/repositories/person.repository.ts
//
// Personas. national_id va cifrado (piiExtension): se lee y escribe en claro y se busca por su hash.
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { Person, Prisma } from '../../../shared/database/generated/prisma/client';
import { hashValue } from '../../../shared/database/pii-fields';

class PersonRepository extends PrismaRepository {
  async findById(personId: string): Promise<Person | null> {
    return (await this.db()).person.findUnique({ where: { personId } });
  }

  async findByNationalId(nationalId: string): Promise<Person | null> {
    return (await this.db()).person.findFirst({ where: { nationalIdHash: hashValue(nationalId) } });
  }

  async create(data: Prisma.PersonUncheckedCreateInput): Promise<Person> {
    return (await this.db()).person.create({ data });
  }

  /** Actualiza por id; null si la fila no existe. */
  async update(personId: string, data: Prisma.PersonUncheckedUpdateManyInput): Promise<Person | null> {
    const [row] = await (await this.db()).person.updateManyAndReturn({ where: { personId }, data });
    return row ?? null;
  }
}

export default new PersonRepository();
