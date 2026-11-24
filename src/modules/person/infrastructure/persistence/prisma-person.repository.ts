// Adaptador Prisma del puerto PersonRepository. national_id va cifrado (extensión de Prisma): se escribe y se
// lee en claro y se busca por su hash.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import { hashValue } from '../../../../shared/infrastructure/database/pii-fields';
import type { PersonRepository } from '../../application/ports/person-repository.port';
import type { NewPerson, Person, PersonChanges } from '../../domain/person';
import { PersonMapper } from './person.mapper';

const toDomain = PersonMapper.personToDomain;

export class PrismaPersonRepository extends PrismaRepository implements PersonRepository {
  async findById(personId: string): Promise<Person | null> {
    const row = await (await this.db()).person.findUnique({ where: { personId } });
    return row ? toDomain(row) : null;
  }

  async findByNationalId(nationalId: string): Promise<Person | null> {
    const row = await (await this.db()).person.findFirst({ where: { nationalIdHash: hashValue(nationalId) } });
    return row ? toDomain(row) : null;
  }

  async create(data: NewPerson): Promise<Person> {
    return toDomain(await (await this.db()).person.create({ data }));
  }

  async update(personId: string, changes: PersonChanges): Promise<void> {
    await (await this.db()).person.updateMany({ where: { personId }, data: changes });
  }
}
