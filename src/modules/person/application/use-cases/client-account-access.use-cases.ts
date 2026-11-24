// Acceso de una cuenta de cliente desde el panel: activarla o desactivarla y cambiarle el rol (solo entre
// roles de cliente).
import type { AdminAuditContext } from '../../../../shared/application/audit-context';
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { UnitOfWork } from '../../../../shared/application/ports/unit-of-work.port';
import type { AccountChangeLog } from '../ports/account-change-log.port';
import type { ClientAccounts, RoleDirectory } from '../ports/client-accounts.port';
import { adminActionNotice, sendLater, type NoticeDeps } from './person-notices';
import { USER_AUDIT_ENTITY } from './person-audit';
import { toAccountStatusOutput, toRoleChangedOutput } from '../dto/admin-person.output';
import {
  assertClientAccount,
  assertClientRoleChange,
  assertNotDeleted,
  assertStatusChange,
  type AccountTarget
} from '../../domain/client-account';
import { RoleNotFoundError, UserNotFoundError } from '../../domain/errors';

/** La cuenta sobre la que actúa el panel: existe y no está eliminada. */
export async function findActionTarget(accounts: ClientAccounts, userId: string): Promise<AccountTarget> {
  const account = await accounts.findTarget(userId);
  if (!account) {
    throw new UserNotFoundError();
  }
  assertNotDeleted(account);
  return account;
}

export class SetClientAccountStatus {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: ClientAccounts,
    private readonly changeLog: AccountChangeLog,
    private readonly audit: AuditTrail,
    private readonly notices: NoticeDeps,
    private readonly action: 'activate' | 'deactivate'
  ) {}

  async execute({ userId, ctx }: { userId: string; ctx: AdminAuditContext }) {
    const activate = this.action === 'activate';
    const account = await this.unitOfWork.run(async () => {
      const account = await findActionTarget(this.accounts, userId);
      assertStatusChange(account, activate);
      await this.accounts.setActive(userId, activate);
      await this.changeLog.record({
        userId: account.userId,
        changedByUserId: ctx.adminUserId,
        changedByRole: 'admin',
        changeType: 'account_status',
        previousValue: activate ? 'inactive' : 'active',
        newValue: activate ? 'active' : 'inactive',
        changeReason: `Usuario ${activate ? 'activado' : 'desactivado'} por administrador`
      });
      return account;
    });

    await this.audit.record(activate ? 'PERSON_ACTIVATED' : 'PERSON_DEACTIVATED', {
      actorId: ctx.adminUserId,
      details: { before: { isActive: !activate }, after: { isActive: activate } },
      entityId: userId,
      ...USER_AUDIT_ENTITY
    });

    sendLater(this.notices, [
      {
        to: 'user',
        type: activate ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_DEACTIVATED',
        userId,
        metadata: { nombre: account.person?.firstName || 'Usuario', email: account.person?.contact?.email, logoUrl: this.notices.logoUrl },
        failure: 'Error sending status notification'
      },
      adminActionNotice(this.notices, ctx, this.action, userId)
    ]);

    return toAccountStatusOutput(account, activate, this.action);
  }
}

export class ChangeClientRole {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: ClientAccounts,
    private readonly roles: RoleDirectory,
    private readonly changeLog: AccountChangeLog,
    private readonly audit: AuditTrail,
    private readonly notices: NoticeDeps
  ) {}

  async execute({ userId, newRoleId, ctx }: { userId: string; newRoleId: string; ctx: AdminAuditContext }) {
    const { account, oldRole, newRole } = await this.unitOfWork.run(async () => {
      const account = await findActionTarget(this.accounts, userId);
      assertClientAccount(account);
      const newRole = await this.roles.findById(newRoleId);
      if (!newRole) {
        throw new RoleNotFoundError();
      }
      assertClientRoleChange(account, newRole);

      const oldRole = account.role ?? null;
      await this.accounts.setRole(userId, newRoleId);
      await this.changeLog.record({
        userId: account.userId,
        changedByUserId: ctx.adminUserId,
        changedByRole: 'admin',
        changeType: 'role',
        previousValue: oldRole?.name ?? null,
        newValue: newRole.name,
        changeReason: 'Rol actualizado por administrador'
      });
      return { account, oldRole, newRole };
    });

    await this.audit.record('PERSON_ROLE_CHANGED', {
      actorId: ctx.adminUserId,
      details: { before: { role: oldRole?.name ?? null }, after: { role: newRole.name } },
      entityId: userId,
      ...USER_AUDIT_ENTITY
    });

    sendLater(this.notices, [
      {
        to: 'user',
        type: 'ROL_CHANGE',
        userId: account.userId,
        metadata: {
          nombre: account.person?.firstName || 'Usuario',
          email: account.person?.contact?.email,
          nuevo_rol: newRole.name,
          permisos_descripcion: newRole.description,
          logoUrl: this.notices.logoUrl
        },
        failure: 'Error sending role change notification'
      },
      adminActionNotice(this.notices, ctx, 'cambiar_rol', userId)
    ]);

    return toRoleChangedOutput(account, oldRole, newRole);
  }
}
