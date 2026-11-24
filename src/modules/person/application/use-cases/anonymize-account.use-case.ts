// Caso de uso compartido: eliminar una cuenta (derecho de supresión). Ofusca persona, usuario y contacto,
// borra la dirección y revoca los consentimientos. Lo usan el titular, el panel de clientes y, por el
// index.ts transitorio, la baja de usuarios internos de iam. Corre dentro de la unidad de trabajo de quien
// lo llama.
import type { AccountChangeLog } from '../ports/account-change-log.port';
import type { ClientAccounts } from '../ports/client-accounts.port';
import type { PersonContactRepository } from '../ports/person-contact-repository.port';
import type { PersonLocationRepository } from '../ports/person-location-repository.port';
import type { PersonRepository } from '../ports/person-repository.port';
import type { ProfileConsents } from '../ports/profile-consents.port';
import type { ChangeActor } from './person-audit';
import { anonymizeAccount } from '../../domain/account-deletion';
import { ContactNotFoundError } from '../../domain/errors';

export interface AnonymizeAccountInput {
  userId: string;
  personId: string;
  /** El documento actual (sus primeros caracteres quedan en el valor ofuscado). */
  nationalId: string | null;
  username: string;
  /** Adónde avisar de la baja. */
  email?: string | null;
  firstName?: string | null;
  changedBy: ChangeActor;
  changeReason: string;
}

export interface AnonymizedAccount {
  deletedEmail: string | null | undefined;
  deletedNationalId: string;
  firstName: string | null | undefined;
}

export class AnonymizeAccount {
  constructor(
    private readonly persons: PersonRepository,
    private readonly contacts: PersonContactRepository,
    private readonly locations: PersonLocationRepository,
    private readonly accounts: ClientAccounts,
    private readonly consents: ProfileConsents,
    private readonly changeLog: AccountChangeLog
  ) {}

  async execute(input: AnonymizeAccountInput): Promise<AnonymizedAccount> {
    const { userId, personId, changedBy } = input;
    const contact = await this.contacts.findByPersonId(personId);
    if (!contact) {
      throw new ContactNotFoundError();
    }

    const at = new Date();
    const anonymized = anonymizeAccount({ nationalId: input.nationalId, username: input.username, contact }, at);

    await this.persons.update(personId, anonymized.person);
    await this.accounts.markDeleted(userId, anonymized.username, at);
    await this.contacts.update(contact.personContactId, anonymized.contact);
    await this.locations.eraseAddress(personId);
    await this.consents.revokeAll(userId);

    await this.changeLog.record({
      userId,
      changedByUserId: changedBy.userId,
      changedByRole: changedBy.role,
      changeType: 'account_status',
      previousValue: 'active',
      newValue: 'eliminated',
      changeReason: input.changeReason
    });

    return { deletedEmail: input.email, deletedNationalId: anonymized.person.nationalId as string, firstName: input.firstName };
  }
}
