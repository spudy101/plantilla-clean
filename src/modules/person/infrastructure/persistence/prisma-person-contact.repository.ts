// Adaptador Prisma del puerto PersonContactRepository. Email y teléfonos van cifrados (extensión de Prisma): se
// escriben y se leen en claro y se buscan por su hash.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import { hashValue } from '../../../../shared/infrastructure/database/pii-fields';
import type { PersonContactRepository } from '../../application/ports/person-contact-repository.port';
import type { ContactChanges, NewPersonContact, PersonContact, PersonContactWithPrefixes } from '../../domain/person-contact';
import { PersonMapper } from './person.mapper';

const toDomain = PersonMapper.contactToDomain;
const PREFIX_REF = { select: { phonePrefixId: true, prefix: true } } satisfies Prisma.PhonePrefixDefaultArgs;

export class PrismaPersonContactRepository extends PrismaRepository implements PersonContactRepository {
  async findByPersonId(personId: string): Promise<PersonContact | null> {
    const row = await (await this.db()).personContact.findUnique({ where: { personId } });
    return row ? toDomain(row) : null;
  }

  async findByPersonIdWithPrefixes(personId: string): Promise<PersonContactWithPrefixes | null> {
    const row = await (await this.db()).personContact.findUnique({
      where: { personId },
      include: { phonePrimaryPrefix: PREFIX_REF, phoneSecondaryPrefix: PREFIX_REF }
    });
    return row ? PersonMapper.contactWithPrefixesToDomain(row) : null;
  }

  async findByEmail(email: string): Promise<PersonContact | null> {
    const row = await (await this.db()).personContact.findFirst({ where: { emailHash: hashValue(email) } });
    return row ? toDomain(row) : null;
  }

  async findByPrimaryPhone(phone: string): Promise<PersonContact | null> {
    const row = await (await this.db()).personContact.findFirst({ where: { phonePrimaryHash: hashValue(phone) } });
    return row ? toDomain(row) : null;
  }

  async findBySecondaryPhone(phone: string): Promise<PersonContact | null> {
    const row = await (await this.db()).personContact.findFirst({ where: { phoneSecondaryHash: hashValue(phone) } });
    return row ? toDomain(row) : null;
  }

  async create(data: NewPersonContact): Promise<PersonContact> {
    return toDomain(await (await this.db()).personContact.create({ data }));
  }

  async update(personContactId: string, changes: ContactChanges): Promise<void> {
    await (await this.db()).personContact.updateMany({ where: { personContactId }, data: changes });
  }

  /**
   * @deprecated Transitorio para iam (reset de credenciales): el contacto por email con la persona y su usuario.
   * Cuando iam se migre, lo pedirá por un puerto propio.
   */
  async findByEmailWithUser(email: string) {
    return (await this.db()).personContact.findFirst({
      where: { emailHash: hashValue(email) },
      include: { person: { select: { personId: true, firstName: true, user: { select: { userId: true, isActive: true } } } } }
    });
  }
}
