// Unicidad de los datos que identifican a una persona: documento, email y teléfono. La usan los casos de uso
// de person y el alta de usuarios internos de iam (por src/main/adapters/iam-sources.adapter.ts).
import type { PersonContactRepository } from '../ports/person-contact-repository.port';
import type { PersonRepository } from '../ports/person-repository.port';
import { belongsToAnother } from '../../domain/person-contact';
import { EmailTakenError, NationalIdTakenError, PhoneTakenError } from '../../domain/errors';

export class IdentityChecks {
  constructor(
    private readonly persons: PersonRepository,
    private readonly contacts: PersonContactRepository
  ) {}

  /** El documento no lo tiene otra persona (`exceptPersonId`: la propia, al cambiarlo). */
  async assertNationalIdAvailable(nationalId: string, exceptPersonId: string | null = null): Promise<void> {
    const existing = await this.persons.findByNationalId(nationalId);
    if (existing && existing.personId !== exceptPersonId) {
      throw new NationalIdTakenError();
    }
  }

  async assertEmailAvailable(email: string, exceptPersonId: string | null = null): Promise<void> {
    if (belongsToAnother(await this.contacts.findByEmail(email), exceptPersonId)) {
      throw new EmailTakenError();
    }
  }

  /** Ni como teléfono principal ni como secundario de otra persona. */
  async assertPhoneAvailable(phone: string, exceptPersonId: string): Promise<void> {
    if (belongsToAnother(await this.contacts.findByPrimaryPhone(phone), exceptPersonId)) {
      throw new PhoneTakenError();
    }
    if (belongsToAnother(await this.contacts.findBySecondaryPhone(phone), exceptPersonId)) {
      throw new PhoneTakenError();
    }
  }
}
