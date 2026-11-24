// Caso de uso compartido: cambiar el email de contacto de una persona. Lo usan el titular (exige el OTP
// confirmado) y el administrador (no lo exige). Corre dentro de la unidad de trabajo de quien lo llama.
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { AccountChangeLog } from '../ports/account-change-log.port';
import type { ContactVerifications } from '../ports/contact-verifications.port';
import type { PersonContactRepository } from '../ports/person-contact-repository.port';
import type { IdentityChecks } from './identity-checks';
import type { ChangeActor } from './person-audit';
import { emailChanges } from '../../domain/person-contact';
import { ContactNotFoundError, ContactNotVerifiedError } from '../../domain/errors';

export interface ChangeContactEmailInput {
  userId: string;
  personId: string;
  newEmail: string;
  changedBy: ChangeActor;
  changeReason: string;
  /** El titular debe haber confirmado el email nuevo con un OTP; un administrador no. */
  requireVerification: boolean;
}

export class ChangeContactEmail {
  constructor(
    private readonly contacts: PersonContactRepository,
    private readonly identity: IdentityChecks,
    private readonly verifications: ContactVerifications,
    private readonly changeLog: AccountChangeLog,
    private readonly logger: Logger
  ) {}

  async execute({ userId, personId, newEmail, changedBy, changeReason, requireVerification }: ChangeContactEmailInput) {
    if (requireVerification && !(await this.verifications.isVerified('email', newEmail))) {
      throw new ContactNotVerifiedError('email');
    }
    await this.identity.assertEmailAvailable(newEmail, personId);

    const contact = await this.contacts.findByPersonId(personId);
    if (!contact) {
      throw new ContactNotFoundError();
    }
    const oldEmail = contact.email;
    await this.contacts.update(contact.personContactId, emailChanges(contact, newEmail, new Date()));

    await this.changeLog.record({
      userId,
      changedByUserId: changedBy.userId,
      changedByRole: changedBy.role,
      changeType: 'email',
      previousValue: oldEmail,
      newValue: newEmail,
      changeReason
    });

    // El código confirmado ya se usó
    if (requireVerification) {
      setImmediate(() => {
        this.verifications
          .consume('email', newEmail)
          .catch((error: unknown) =>
            this.logger.warn('Error limpiando verification_code de email', { error: error instanceof Error ? error.message : String(error) })
          );
      });
    }

    return { oldEmail, newEmail };
  }
}
