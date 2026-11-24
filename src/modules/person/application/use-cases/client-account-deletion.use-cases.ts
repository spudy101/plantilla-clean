// Baja de una cuenta de cliente desde el panel, con doble aprobación (maker-checker):
//
//   RequestClientAccountDeletion   el administrador (maker) confirma su contraseña y pide la baja. Si la
//                                  operación queda pendiente, responde 202; si no hace falta segunda
//                                  aprobación (flag apagado, super_admin), la ejecuta en el momento.
//   ExecuteClientAccountDeletion   la baja real. También la invoca approvals cuando el checker aprueba.
import type { AdminAuditContext } from '../../../../shared/application/audit-context';
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { UnitOfWork } from '../../../../shared/application/ports/unit-of-work.port';
import type { ClientAccounts } from '../ports/client-accounts.port';
import type { DualApprovalGate } from '../ports/dual-approval.port';
import type { AnonymizeAccount } from './anonymize-account.use-case';
import { adminActionNotice, sendLater, type NoticeDeps } from './person-notices';
import { USER_AUDIT_ENTITY } from './person-audit';
import { assertNotDeleted, requirePerson } from '../../domain/client-account';
import { AdminNotFoundError, UserNotFoundError, WrongCurrentPasswordError } from '../../domain/errors';

export class ExecuteClientAccountDeletion {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: ClientAccounts,
    private readonly anonymize: AnonymizeAccount,
    private readonly audit: AuditTrail,
    private readonly notices: NoticeDeps
  ) {}

  async execute({ userId, ctx }: { userId: string; ctx: AdminAuditContext }): Promise<null> {
    const result = await this.unitOfWork.run(async () => {
      const account = await this.accounts.findTarget(userId);
      if (!account) {
        throw new UserNotFoundError();
      }
      const person = requirePerson(account);
      return this.anonymize.execute({
        userId,
        personId: person.personId,
        nationalId: person.nationalId,
        email: person.contact?.email,
        username: account.username,
        firstName: person.firstName,
        changedBy: { userId: ctx.adminUserId, role: 'admin' },
        changeReason: 'Cuenta eliminada por administrador'
      });
    });

    await this.audit.record('PERSON_ACCOUNT_DELETED', { actorId: ctx.adminUserId, entityId: userId, ...USER_AUDIT_ENTITY });

    if (result.deletedEmail) {
      sendLater(
        this.notices,
        [
          {
            to: 'email',
            type: 'CUENTA_ELIMINADA',
            email: result.deletedEmail,
            metadata: { nombre: result.firstName, email: result.deletedEmail, logoUrl: this.notices.logoUrl },
            failure: 'Error sending account deletion notification'
          },
          adminActionNotice(this.notices, ctx, 'eliminar_cuenta', userId)
        ],
        { userId }
      );
    }
    return null;
  }
}

export class RequestClientAccountDeletion {
  constructor(
    private readonly accounts: ClientAccounts,
    private readonly approvals: DualApprovalGate,
    private readonly executeDeletion: ExecuteClientAccountDeletion
  ) {}

  async execute({ userId, currentPassword, ctx }: { userId: string; currentPassword: string; ctx: AdminAuditContext }) {
    // El maker se re-autentica ANTES de gatear la doble aprobación
    const admin = await this.accounts.findSummary(ctx.adminUserId);
    if (!admin) {
      throw new AdminNotFoundError();
    }
    if (!(await this.accounts.passwordMatches(ctx.adminUserId, currentPassword))) {
      throw new WrongCurrentPasswordError();
    }

    // La cuenta debe existir y no estar ya eliminada (no se re-elimina)
    const target = await this.accounts.findTarget(userId);
    if (!target) {
      throw new UserNotFoundError();
    }
    assertNotDeleted(target);

    const gate = await this.approvals.gate('CLIENT_ACCOUNT_DELETE', { entityType: 'User', entityId: userId, payload: { userId }, ctx });
    if (gate.pending) {
      return { pending: true as const, approvalRequest: gate.request };
    }

    await this.executeDeletion.execute({ userId, ctx });
    return null;
  }
}
