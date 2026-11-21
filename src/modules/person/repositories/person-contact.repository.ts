// modules/schemas/kyc/person/repositories/person-contact.repository.ts
//
// Contacto de la persona. email y teléfonos van cifrados (piiExtension): se leen y escriben en claro y
// se buscan por su hash.
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { PersonContact, Prisma } from '../../../shared/infrastructure/database/generated/prisma/client';
import { hashValue } from '../../../shared/infrastructure/database/pii-fields';

const PREFIX_REF = { select: { phonePrefixId: true, prefix: true } } satisfies Prisma.PhonePrefixDefaultArgs;

class PersonContactRepository extends PrismaRepository {
  async findById(personContactId: string): Promise<PersonContact | null> {
    return (await this.db()).personContact.findUnique({ where: { personContactId } });
  }

  async findByEmail(email: string): Promise<PersonContact | null> {
    return (await this.db()).personContact.findFirst({ where: { emailHash: hashValue(email) } });
  }

  /** Contacto por email con la persona (nombre) y su usuario (id, estado): reset de credenciales. */
  async findByEmailWithUser(email: string) {
    return (await this.db()).personContact.findFirst({
      where: { emailHash: hashValue(email) },
      include: {
        person: { select: { personId: true, firstName: true, user: { select: { userId: true, isActive: true } } } }
      }
    });
  }

  async findByPersonId(personId: string): Promise<PersonContact | null> {
    return (await this.db()).personContact.findUnique({ where: { personId } });
  }

  async findByPrimaryPhone(phone: string): Promise<PersonContact | null> {
    return (await this.db()).personContact.findFirst({ where: { phonePrimaryHash: hashValue(phone) } });
  }

  async findBySecondaryPhone(phone: string): Promise<PersonContact | null> {
    return (await this.db()).personContact.findFirst({ where: { phoneSecondaryHash: hashValue(phone) } });
  }

  /** Contacto de la persona con los prefijos de sus teléfonos. */
  async findByPersonIdWithPrefixes(personId: string) {
    return (await this.db()).personContact.findUnique({
      where: { personId },
      include: { phonePrimaryPrefix: PREFIX_REF, phoneSecondaryPrefix: PREFIX_REF }
    });
  }

  async create(data: Prisma.PersonContactUncheckedCreateInput): Promise<PersonContact> {
    return (await this.db()).personContact.create({ data });
  }

  /** Actualiza por id; null si la fila no existe. */
  async update(personContactId: string, data: Prisma.PersonContactUncheckedUpdateManyInput): Promise<PersonContact | null> {
    const [row] = await (await this.db()).personContact.updateManyAndReturn({ where: { personContactId }, data });
    return row ?? null;
  }
}

export default new PersonContactRepository();
