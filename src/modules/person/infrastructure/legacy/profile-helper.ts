// @deprecated TRANSITORIO: lo que iam (alta y baja de usuarios internos) usaba del viejo ProfileHelper, ahora
// sobre los casos de uso de person. Se borra al migrar iam.
import type { AnonymizedAccount } from '../../application/use-cases/anonymize-account.use-case';
import { IdentityChecks } from '../../application/use-cases/identity-checks';
import { PrismaPersonContactRepository } from '../persistence/prisma-person-contact.repository';
import { PrismaPersonRepository } from '../persistence/prisma-person.repository';
import { legacyBindings } from './legacy-bindings';

let identity: IdentityChecks | null = null;
const identityChecks = () => (identity ??= new IdentityChecks(new PrismaPersonRepository(), new PrismaPersonContactRepository()));

/** Baja de una cuenta (iam la usa para los usuarios internos). */
export interface DeleteAccountParams {
  userId: string;
  personId: string;
  nationalId: string | null;
  email?: string | null;
  username: string;
  firstName?: string | null;
  changedByUserId: string;
  changedByRole: 'admin' | 'user';
  changeReason?: string | null;
  /** Ignorado: ip y user-agent salen del contexto de la operación. */
  auditContext?: unknown;
}

export default {
  validateNationalIdUnique(nationalId: string, exceptPersonId: string | null = null): Promise<void> {
    return identityChecks().assertNationalIdAvailable(nationalId, exceptPersonId);
  },

  validateEmailUnique(email: string, exceptPersonId: string | null = null): Promise<void> {
    return identityChecks().assertEmailAvailable(email, exceptPersonId);
  },

  deleteAccountLogic({ changedByUserId, changedByRole, changeReason, auditContext: _auditContext, ...account }: DeleteAccountParams): Promise<AnonymizedAccount> {
    return legacyBindings().anonymizeAccount.execute({
      ...account,
      changedBy: { userId: changedByUserId, role: changedByRole },
      changeReason: changeReason ?? ''
    });
  }
};
