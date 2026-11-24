// Caso de uso: un administrador da de alta una cuenta de cliente (persona + contacto + usuario en una sola
// transacción) con una contraseña temporal, que se devuelve una única vez y se manda por correo.
import type { AdminAuditContext } from '../../../../shared/application/audit-context';
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { IdGenerator } from '../../../../shared/application/ports/id-generator.port';
import type { UnitOfWork } from '../../../../shared/application/ports/unit-of-work.port';
import rbacModule from '../../../../shared/domain/constants/rbac';
import type { ClientAccounts, RoleDirectory } from '../ports/client-accounts.port';
import type { PasswordGenerator } from '../ports/password-generator.port';
import type { PersonContactRepository } from '../ports/person-contact-repository.port';
import type { PersonRepository } from '../ports/person-repository.port';
import type { IdentityChecks } from './identity-checks';
import { adminActionNotice, sendLater, type NoticeDeps } from './person-notices';
import { USER_AUDIT_ENTITY } from './person-audit';
import { toAccountCreatedOutput } from '../dto/admin-person.output';
import { assertNationalIdForRole } from '../../domain/person';
import { ClientRoleNotConfiguredError, CreatedAccountNotFoundError } from '../../domain/errors';

const { RBAC_ROLES } = rbacModule;

export interface NewClientAccountInput {
  email: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  secondLastName?: string | null;
  nationalId: string;
  documentTypeId?: string | null;
  genderId?: string | null;
  countryId?: string | null;
  birthDate?: Date | null;
}

export class CreateClientAccount {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: ClientAccounts,
    private readonly roles: RoleDirectory,
    private readonly persons: PersonRepository,
    private readonly contacts: PersonContactRepository,
    private readonly identity: IdentityChecks,
    private readonly passwords: PasswordGenerator,
    private readonly ids: IdGenerator,
    private readonly audit: AuditTrail,
    private readonly notices: NoticeDeps
  ) {}

  async execute({ data, ctx }: { data: NewClientAccountInput; ctx: AdminAuditContext }) {
    const { role, userId, temporaryPassword } = await this.unitOfWork.run(async () => {
      const role = await this.roles.findByName(RBAC_ROLES.CLIENTE);
      if (!role) {
        throw new ClientRoleNotConfiguredError(RBAC_ROLES.CLIENTE);
      }
      assertNationalIdForRole(data.nationalId, role.name);
      await this.identity.assertNationalIdAvailable(data.nationalId);
      await this.identity.assertEmailAvailable(data.email);

      const temporaryPassword = this.passwords.generate();
      const authUsername = `user_${this.ids.next()}`;

      const person = await this.persons.create({
        firstName: data.firstName,
        middleName: data.middleName || null,
        lastName: data.lastName,
        secondLastName: data.secondLastName || null,
        nationalId: data.nationalId,
        birthDate: data.birthDate || null,
        genderId: data.genderId || null,
        countryId: data.countryId || null,
        documentTypeId: data.documentTypeId || null
      });
      await this.contacts.create({ personId: person.personId, email: data.email, emailVerifiedAt: new Date() });
      const { userId } = await this.accounts.create({
        username: authUsername,
        authUsername,
        personId: person.personId,
        roleId: role.roleId,
        password: temporaryPassword
      });
      return { role, userId, temporaryPassword };
    });

    // Después del commit: un error acá ya no intenta revertir la transacción confirmada
    await this.audit.record('PERSON_CREATED', {
      actorId: ctx.adminUserId,
      details: { roleId: role.roleId, roleName: role.name },
      entityId: userId,
      ...USER_AUDIT_ENTITY
    });

    sendLater(this.notices, [
      {
        to: 'user',
        type: 'USUARIO_CREADO_ADMIN',
        userId,
        metadata: { nombre: data.firstName, email: data.email, passwordTemporal: temporaryPassword, logoUrl: this.notices.logoUrl },
        failure: 'Error sending welcome notification'
      },
      adminActionNotice(this.notices, ctx, 'crear', userId)
    ]);

    const created = await this.accounts.findProfile(userId);
    if (!created) {
      throw new CreatedAccountNotFoundError();
    }
    return toAccountCreatedOutput(created, temporaryPassword);
  }
}
