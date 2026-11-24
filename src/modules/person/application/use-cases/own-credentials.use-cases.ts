// Casos de uso del titular sobre los datos sensibles de su cuenta: email, teléfono, contraseña y la baja.
// Los que tocan credenciales piden antes la contraseña actual.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { UnitOfWork } from '../../../../shared/application/ports/unit-of-work.port';
import type { AccountChangeLog } from '../ports/account-change-log.port';
import type { ClientAccounts } from '../ports/client-accounts.port';
import type { ContactVerifications } from '../ports/contact-verifications.port';
import type { PersonContactRepository } from '../ports/person-contact-repository.port';
import type { AnonymizeAccount } from './anonymize-account.use-case';
import type { ChangeContactEmail } from './change-contact-email.use-case';
import type { IdentityChecks } from './identity-checks';
import type { OwnerRef } from './own-profile.use-cases';
import { sendLater, type NoticeDeps } from './person-notices';
import { USER_AUDIT_ENTITY } from './person-audit';
import { toEmailUpdatedOutput, toPhoneUpdatedOutput } from '../dto/profile.output';
import { phoneChanges, phoneOf, type PhoneType } from '../../domain/person-contact';
import { ContactNotFoundError, ContactNotVerifiedError, UserNotFoundError, WrongCurrentPasswordError } from '../../domain/errors';

/** La cuenta existe y la contraseña que mandó el titular es la suya. */
async function confirmOwner(accounts: ClientAccounts, userId: string, currentPassword: string) {
  const account = await accounts.findSummary(userId);
  if (!account) {
    throw new UserNotFoundError();
  }
  if (!(await accounts.passwordMatches(userId, currentPassword))) {
    throw new WrongCurrentPasswordError();
  }
  return account;
}

const profileNotice = (type: string, userId: string, firstName: string | null, failure: string) =>
  ({ to: 'user' as const, type, userId, metadata: { nombre: firstName }, failure });

export interface UpdateOwnEmailInput extends OwnerRef {
  firstName: string | null;
  email: string;
  currentPassword: string;
}

/** PUT /person/profile/email: exige la contraseña actual y el email nuevo confirmado por OTP. */
export class UpdateOwnEmail {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: ClientAccounts,
    private readonly changeEmail: ChangeContactEmail,
    private readonly audit: AuditTrail,
    private readonly notices: NoticeDeps
  ) {}

  async execute({ userId, personId, firstName, email, currentPassword }: UpdateOwnEmailInput) {
    await confirmOwner(this.accounts, userId, currentPassword);

    const { newEmail } = await this.unitOfWork.run(() =>
      this.changeEmail.execute({
        userId,
        personId,
        newEmail: email,
        changedBy: { userId, role: 'user' },
        changeReason: 'Email actualizado por cliente',
        requireVerification: true
      })
    );

    // Dato de contacto crítico: riesgo high
    await this.audit.record('PROFILE_EMAIL_UPDATED', { actorId: userId, details: { newEmail }, entityId: userId, ...USER_AUDIT_ENTITY });
    sendLater(this.notices, [profileNotice('EMAIL_UPDATED', userId, firstName, 'Error enviando notificacion email updated')], { userId });

    return toEmailUpdatedOutput(newEmail, new Date());
  }
}

export interface UpdateOwnPhoneInput extends OwnerRef {
  firstName: string | null;
  newPhone: string;
  phonePrefixId: string;
  phoneType: PhoneType;
}

/** PUT /person/profile/phone: el teléfono nuevo debe estar confirmado por OTP y no ser de otra persona. */
export class UpdateOwnPhone {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly contacts: PersonContactRepository,
    private readonly identity: IdentityChecks,
    private readonly verifications: ContactVerifications,
    private readonly changeLog: AccountChangeLog,
    private readonly audit: AuditTrail,
    private readonly notices: NoticeDeps,
    private readonly logger: Logger
  ) {}

  async execute({ userId, personId, firstName, newPhone, phonePrefixId, phoneType }: UpdateOwnPhoneInput) {
    await this.unitOfWork.run(async () => {
      if (!(await this.verifications.isVerified('phone', newPhone))) {
        throw new ContactNotVerifiedError('phone');
      }
      await this.identity.assertPhoneAvailable(newPhone, personId);

      const contact = await this.contacts.findByPersonId(personId);
      if (!contact) {
        throw new ContactNotFoundError();
      }
      const oldPhone = phoneOf(contact, phoneType);
      await this.contacts.update(contact.personContactId, phoneChanges(newPhone, phonePrefixId, phoneType, new Date()));

      await this.changeLog.record({
        userId,
        changedByUserId: userId,
        changedByRole: 'user',
        changeType: 'phone',
        previousValue: oldPhone ?? null,
        newValue: newPhone,
        changeReason: `Teléfono ${phoneType} actualizado`
      });

      // El código confirmado ya se usó
      setImmediate(() => {
        this.verifications.consume('phone', newPhone).catch((error: unknown) =>
          this.logger.warn('Error limpiando verification_code de phone', {
            error: error instanceof Error ? error.message : String(error),
            phone: newPhone
          })
        );
      });
    });

    await this.audit.record('PROFILE_PHONE_UPDATED', { actorId: userId, details: { phoneType }, entityId: userId, ...USER_AUDIT_ENTITY });
    sendLater(this.notices, [profileNotice('PHONE_UPDATED', userId, firstName, 'Error enviando notificacion phone updated')], { userId });

    return toPhoneUpdatedOutput(newPhone, phonePrefixId, phoneType, new Date());
  }
}

export interface UpdateOwnPasswordInput {
  userId: string;
  firstName: string | null;
  currentPassword: string;
  newPassword: string;
}

/** PUT /person/profile/password */
export class UpdateOwnPassword {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: ClientAccounts,
    private readonly changeLog: AccountChangeLog,
    private readonly audit: AuditTrail,
    private readonly notices: NoticeDeps
  ) {}

  async execute({ userId, firstName, currentPassword, newPassword }: UpdateOwnPasswordInput): Promise<null> {
    await confirmOwner(this.accounts, userId, currentPassword);

    await this.unitOfWork.run(async () => {
      await this.accounts.setPassword(userId, newPassword);
      await this.changeLog.record({
        userId,
        changedByUserId: userId,
        changedByRole: 'user',
        changeType: 'password',
        previousValue: 'hidden',
        newValue: 'hidden',
        changeReason: 'Contrasena actualizada por cliente'
      });
    });

    // Cambio de contraseña: riesgo high
    await this.audit.record('PASSWORD_CHANGED', { actorId: userId, entityId: userId, ...USER_AUDIT_ENTITY });
    sendLater(this.notices, [profileNotice('PASSWORD_UPDATED', userId, firstName, 'Error enviando notificacion password updated')], { userId });
    return null;
  }
}

export interface DeleteOwnAccountInput extends OwnerRef {
  /** Del token: puede faltar en tokens viejos (la ofuscación no depende del valor previo). */
  nationalId: string | null;
  email?: string | null;
  firstName?: string | null;
  currentPassword: string;
}

/** DELETE /person/profile/delete-account: irreversible. */
export class DeleteOwnAccount {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: ClientAccounts,
    private readonly anonymize: AnonymizeAccount,
    private readonly audit: AuditTrail,
    private readonly notices: NoticeDeps
  ) {}

  async execute({ userId, personId, nationalId, email, firstName, currentPassword }: DeleteOwnAccountInput): Promise<null> {
    const account = await confirmOwner(this.accounts, userId, currentPassword);

    const result = await this.unitOfWork.run(() =>
      this.anonymize.execute({
        userId,
        personId,
        nationalId,
        email,
        username: account.username,
        firstName: firstName || account.firstName || 'Usuario',
        changedBy: { userId, role: 'user' },
        changeReason: 'Cuenta eliminada por el usuario'
      })
    );

    // Acción irreversible: riesgo crítico
    await this.audit.record('ACCOUNT_DELETED', { actorId: userId, entityId: userId, ...USER_AUDIT_ENTITY });

    if (result.deletedEmail) {
      sendLater(
        this.notices,
        [
          {
            to: 'email',
            type: 'CUENTA_ELIMINADA',
            email: result.deletedEmail,
            metadata: { nombre: result.firstName, email: result.deletedEmail },
            failure: 'Error sending account deletion notification'
          }
        ],
        { userId }
      );
    }
    return null;
  }
}
