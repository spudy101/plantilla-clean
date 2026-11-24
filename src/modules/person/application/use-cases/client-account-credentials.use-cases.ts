// Credenciales e identidad de una cuenta de cliente desde el panel: resetear la contraseña, cambiar el email
// o el documento y desactivar el MFA.
import type { AdminAuditContext } from '../../../../shared/application/audit-context';
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { UnitOfWork } from '../../../../shared/application/ports/unit-of-work.port';
import type { AccountChangeLog } from '../ports/account-change-log.port';
import type { ClientAccounts } from '../ports/client-accounts.port';
import type { PasswordGenerator } from '../ports/password-generator.port';
import type { PersonRepository } from '../ports/person-repository.port';
import type { ChangeContactEmail } from './change-contact-email.use-case';
import type { IdentityChecks } from './identity-checks';
import { findActionTarget } from './client-account-access.use-cases';
import { adminActionNotice, sendLater, type NoticeDeps } from './person-notices';
import { USER_AUDIT_ENTITY } from './person-audit';
import {
  toEmailChangedOutput,
  toMfaDisabledOutput,
  toNationalIdChangedOutput,
  toPasswordResetOutput
} from '../dto/admin-person.output';
import { mfaShutdown, requirePerson } from '../../domain/client-account';
import { assertNationalIdForRole } from '../../domain/person';
import { PersonNotFoundError } from '../../domain/errors';

interface TargetInput {
  userId: string;
  ctx: AdminAuditContext;
}

export class ResetClientPassword {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: ClientAccounts,
    private readonly passwords: PasswordGenerator,
    private readonly changeLog: AccountChangeLog,
    private readonly audit: AuditTrail,
    private readonly notices: NoticeDeps
  ) {}

  async execute({ userId, ctx }: TargetInput) {
    const { account, temporaryPassword } = await this.unitOfWork.run(async () => {
      const account = await findActionTarget(this.accounts, userId);
      const temporaryPassword = this.passwords.generate();
      await this.accounts.setPassword(userId, temporaryPassword);
      await this.changeLog.record({
        userId: account.userId,
        changedByUserId: ctx.adminUserId,
        changedByRole: 'admin',
        changeType: 'password',
        previousValue: 'hidden',
        newValue: 'hidden',
        changeReason: 'Contraseña reseteada por administrador'
      });
      return { account, temporaryPassword };
    });

    await this.audit.record('PERSON_PASSWORD_RESET', { actorId: ctx.adminUserId, entityId: userId, ...USER_AUDIT_ENTITY });

    sendLater(this.notices, [
      {
        to: 'user',
        type: 'PASSWORD_RESET_ADMIN',
        userId: account.userId,
        metadata: {
          nombre: account.person?.firstName || 'Usuario',
          email: account.person?.contact?.email,
          passwordTemporal: temporaryPassword,
          logoUrl: this.notices.logoUrl
        },
        failure: 'Error sending password reset notification'
      },
      adminActionNotice(this.notices, ctx, 'reset_password', userId)
    ]);

    return toPasswordResetOutput(account);
  }
}

/** El administrador cambia el email: no exige OTP y avisa a la dirección vieja y a la nueva. */
export class ChangeClientEmail {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: ClientAccounts,
    private readonly changeEmail: ChangeContactEmail,
    private readonly audit: AuditTrail,
    private readonly notices: NoticeDeps
  ) {}

  async execute({ userId, newEmail, ctx }: TargetInput & { newEmail: string }) {
    const { account, oldEmail, updatedEmail } = await this.unitOfWork.run(async () => {
      const account = await findActionTarget(this.accounts, userId);
      const { oldEmail, newEmail: updatedEmail } = await this.changeEmail.execute({
        userId,
        personId: requirePerson(account).personId,
        newEmail,
        changedBy: { userId: ctx.adminUserId, role: 'admin' },
        changeReason: 'Email actualizado por administrador',
        requireVerification: false
      });
      return { account, oldEmail, updatedEmail };
    });

    await this.audit.record('PERSON_EMAIL_CHANGED', {
      actorId: ctx.adminUserId,
      details: { before: { email: oldEmail }, after: { email: updatedEmail } },
      entityId: userId,
      ...USER_AUDIT_ENTITY
    });

    const nombre = account.person?.firstName;
    const { logoUrl } = this.notices;
    sendLater(this.notices, [
      { to: 'email', type: 'EMAIL_CHANGED_OLD', email: oldEmail, metadata: { nombre, email: oldEmail, logoUrl }, failure: 'Error sending old email notification' },
      {
        to: 'user',
        type: 'EMAIL_CHANGED_NEW',
        userId: account.userId,
        metadata: { nombre, email: updatedEmail, logoUrl },
        failure: 'Error sending new email notification'
      },
      adminActionNotice(this.notices, ctx, 'cambiar_email', userId)
    ]);

    return toEmailChangedOutput(account, oldEmail, updatedEmail);
  }
}

/**
 * El administrador corrige el documento (para el titular es inmutable). Idempotente: si el valor no cambia,
 * no se toca la base ni se audita ni se avisa, y se responde igual.
 */
export class ChangeClientNationalId {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: ClientAccounts,
    private readonly persons: PersonRepository,
    private readonly identity: IdentityChecks,
    private readonly changeLog: AccountChangeLog,
    private readonly audit: AuditTrail,
    private readonly notices: NoticeDeps
  ) {}

  async execute({ userId, newNationalId, ctx }: TargetInput & { newNationalId: string }) {
    const { account, oldNationalId, unchanged } = await this.unitOfWork.run(async () => {
      const account = await findActionTarget(this.accounts, userId);
      const { personId } = requirePerson(account);
      const person = await this.persons.findById(personId);
      if (!person) {
        throw new PersonNotFoundError();
      }
      const oldNationalId = person.nationalId;
      if (oldNationalId === newNationalId) {
        return { account, oldNationalId, unchanged: true };
      }

      // Sin rol cargado no hay regla de formato que aplicar
      assertNationalIdForRole(newNationalId, account.role?.name ?? '');
      await this.identity.assertNationalIdAvailable(newNationalId, personId);
      await this.persons.update(personId, { nationalId: newNationalId });
      await this.changeLog.record({
        userId,
        changedByUserId: ctx.adminUserId,
        changedByRole: 'admin',
        changeType: 'national_id',
        previousValue: oldNationalId,
        newValue: newNationalId,
        changeReason: 'National ID actualizado por administrador'
      });
      return { account, oldNationalId, unchanged: false };
    });

    if (unchanged) {
      return toNationalIdChangedOutput(account, oldNationalId, newNationalId);
    }

    await this.audit.record('PERSON_NATIONAL_ID_CHANGED', {
      actorId: ctx.adminUserId,
      details: { before: { nationalId: oldNationalId }, after: { nationalId: newNationalId } },
      entityId: userId,
      ...USER_AUDIT_ENTITY
    });

    sendLater(this.notices, [
      {
        to: 'user',
        type: 'NATIONAL_ID_CHANGED',
        userId: account.userId,
        metadata: { nombre: account.person?.firstName, email: account.person?.contact?.email, logoUrl: this.notices.logoUrl },
        failure: 'Error sending national id notification'
      },
      adminActionNotice(this.notices, ctx, 'cambiar_national_id', userId)
    ]);

    return toNationalIdChangedOutput(account, oldNationalId, newNationalId);
  }
}

export class DisableClientMfa {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: ClientAccounts,
    private readonly changeLog: AccountChangeLog,
    private readonly audit: AuditTrail,
    private readonly notices: NoticeDeps
  ) {}

  async execute({ userId, ctx }: TargetInput) {
    const account = await this.unitOfWork.run(async () => {
      const account = await findActionTarget(this.accounts, userId);
      await this.accounts.shutDownMfa(userId, mfaShutdown(account));
      await this.changeLog.record({
        userId: account.userId,
        changedByUserId: ctx.adminUserId,
        changedByRole: 'admin',
        changeType: 'mfa_status',
        previousValue: 'enabled',
        newValue: 'disabled',
        changeReason: 'MFA desactivado por administrador'
      });
      return account;
    });

    await this.audit.record('PERSON_MFA_DISABLED', {
      actorId: ctx.adminUserId,
      details: { before: { mfaEnabled: true }, after: { mfaEnabled: false } },
      entityId: userId,
      ...USER_AUDIT_ENTITY
    });

    sendLater(this.notices, [
      {
        to: 'user',
        type: 'RESET_MFA',
        userId: account.userId,
        metadata: { nombre: account.person?.firstName || 'Usuario', email: account.person?.contact?.email, logoUrl: this.notices.logoUrl },
        failure: 'Error sending MFA reset notification'
      },
      adminActionNotice(this.notices, ctx, 'deshabilitar_mfa', userId)
    ]);

    return toMfaDisabledOutput(account);
  }
}
