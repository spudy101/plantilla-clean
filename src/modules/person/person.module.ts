// Composición del módulo person: el ÚNICO archivo del módulo que conoce todas sus capas.
//
//   Prisma (personas, contactos, ubicaciones, referencias) ──► casos de uso ──► controllers ──► routers
//                         │
//                         └──► ExecuteClientAccountDeletion: la baja que reanuda la doble aprobación
//
// Lo que viene de afuera (cuentas y roles de iam, catálogos, códigos OTP de notification, consentimientos de
// legal, bitácora y auditoría de audit, doble aprobación de approvals, avisos, logger, transacciones, guardas)
// llega por parámetro desde src/main/. Person no importa ningún otro módulo.
import type { Router } from 'express';
import type { AuditTrail } from '../../shared/application/ports/audit-trail.port';
import type { IdGenerator } from '../../shared/application/ports/id-generator.port';
import type { Logger } from '../../shared/application/ports/logger.port';
import type { EmailNotifier, Notifier } from '../../shared/application/ports/notifier.port';
import type { UnitOfWork } from '../../shared/application/ports/unit-of-work.port';
import type { RouteGuards } from '../../shared/presentation/http/route-guards';
import type { AccountChangeLog } from './application/ports/account-change-log.port';
import type { ClientAccounts, RoleDirectory } from './application/ports/client-accounts.port';
import type { ContactVerifications } from './application/ports/contact-verifications.port';
import type { DualApprovalGate } from './application/ports/dual-approval.port';
import type { ProfileCatalogs } from './application/ports/profile-catalogs.port';
import type { ProfileConsents } from './application/ports/profile-consents.port';
import { PrismaPersonRepository } from './infrastructure/persistence/prisma-person.repository';
import { PrismaPersonContactRepository } from './infrastructure/persistence/prisma-person-contact.repository';
import { PrismaPersonLocationRepository } from './infrastructure/persistence/prisma-person-location.repository';
import { PrismaPersonReferenceRepository } from './infrastructure/persistence/prisma-person-reference.repository';
import { securePasswordGenerator } from './infrastructure/security/secure-password.generator';
import { IdentityChecks } from './application/use-cases/identity-checks';
import { AccountHolders } from './application/use-cases/account-holders.use-cases';
import { CatalogChecks } from './application/use-cases/catalog-checks';
import { ChangeContactEmail } from './application/use-cases/change-contact-email.use-case';
import { AnonymizeAccount } from './application/use-cases/anonymize-account.use-case';
import { GetOwnContact, GetOwnLocation, GetOwnProfile, UpdateOwnNames, UpdateOwnProfile } from './application/use-cases/own-profile.use-cases';
import { DeleteOwnAccount, UpdateOwnEmail, UpdateOwnPassword, UpdateOwnPhone } from './application/use-cases/own-credentials.use-cases';
import {
  GetClientAccount,
  ListClientAccounts,
  ListClientRoleOptions,
  ListDeletedClientAccounts
} from './application/use-cases/client-account-queries.use-cases';
import { CreateClientAccount } from './application/use-cases/create-client-account.use-case';
import { ChangeClientRole, SetClientAccountStatus } from './application/use-cases/client-account-access.use-cases';
import {
  ChangeClientEmail,
  ChangeClientNationalId,
  DisableClientMfa,
  ResetClientPassword
} from './application/use-cases/client-account-credentials.use-cases';
import { ExecuteClientAccountDeletion, RequestClientAccountDeletion } from './application/use-cases/client-account-deletion.use-cases';
import { CreateReference, ListReferences, RemoveReference, UpdateReference } from './application/use-cases/person-references.use-cases';
import { AdminPersonController } from './presentation/http/admin-person.controller';
import { ProfileController } from './presentation/http/profile.controller';
import { PersonReferenceController } from './presentation/http/person-reference.controller';
import { createAdminPersonRouter, createPersonReferenceRouter, createProfileRouter } from './presentation/http/person.routes';

export interface PersonModuleDeps {
  audit: AuditTrail;
  /** La bitácora de cambios de las cuentas (valor anterior → nuevo). */
  changeLog: AccountChangeLog;
  notifier: Notifier & EmailNotifier;
  logger: Logger;
  unitOfWork: UnitOfWork;
  ids: IdGenerator;
  guards: RouteGuards;
  accounts: ClientAccounts;
  roles: RoleDirectory;
  catalogs: ProfileCatalogs;
  verifications: ContactVerifications;
  consents: ProfileConsents;
  approvals: DualApprovalGate;
  /** Logo de las plantillas de correo. */
  notificationLogoUrl: string | null | undefined;
}

export interface PersonModule {
  /** Panel de clientes (solo admin). */
  adminRouter: Router;
  /** Perfil propio (admin y client). */
  profileRouter: Router;
  /** Referencias personales (solo client). */
  clientRouter: Router;
  useCases: {
    /** La baja real de una cuenta de cliente: la reanuda approvals cuando el segundo funcionario aprueba. */
    executeClientAccountDeletion: ExecuteClientAccountDeletion;
    /** Lo que usa iam: la persona de las cuentas que crea, la unicidad de documento y email, y la baja de un interno. */
    accountHolders: AccountHolders;
    identityChecks: IdentityChecks;
    anonymizeAccount: AnonymizeAccount;
  };
}

export function createPersonModule(deps: PersonModuleDeps): PersonModule {
  const { audit, changeLog, unitOfWork, accounts, roles, logger } = deps;
  const notices = { notifier: deps.notifier, logger, logoUrl: deps.notificationLogoUrl };

  const persons = new PrismaPersonRepository();
  const contacts = new PrismaPersonContactRepository();
  const locations = new PrismaPersonLocationRepository();
  const references = new PrismaPersonReferenceRepository();

  const identity = new IdentityChecks(persons, contacts);
  const catalogs = new CatalogChecks(deps.catalogs);
  const changeEmail = new ChangeContactEmail(contacts, identity, deps.verifications, changeLog, logger);
  const anonymize = new AnonymizeAccount(persons, contacts, locations, accounts, deps.consents, changeLog);
  const executeDeletion = new ExecuteClientAccountDeletion(unitOfWork, accounts, anonymize, audit, notices);

  const adminController = new AdminPersonController({
    list: new ListClientAccounts(accounts, roles, audit),
    listDeleted: new ListDeletedClientAccounts(accounts, roles, audit),
    listRoleOptions: new ListClientRoleOptions(roles, audit),
    get: new GetClientAccount(accounts, audit),
    create: new CreateClientAccount(unitOfWork, accounts, roles, persons, contacts, identity, securePasswordGenerator, deps.ids, audit, notices),
    activate: new SetClientAccountStatus(unitOfWork, accounts, changeLog, audit, notices, 'activate'),
    deactivate: new SetClientAccountStatus(unitOfWork, accounts, changeLog, audit, notices, 'deactivate'),
    resetPassword: new ResetClientPassword(unitOfWork, accounts, securePasswordGenerator, changeLog, audit, notices),
    disableMfa: new DisableClientMfa(unitOfWork, accounts, changeLog, audit, notices),
    changeEmail: new ChangeClientEmail(unitOfWork, accounts, changeEmail, audit, notices),
    changeNationalId: new ChangeClientNationalId(unitOfWork, accounts, persons, identity, changeLog, audit, notices),
    changeRole: new ChangeClientRole(unitOfWork, accounts, roles, changeLog, audit, notices),
    requestDeletion: new RequestClientAccountDeletion(accounts, deps.approvals, executeDeletion)
  });

  const profileController = new ProfileController({
    getProfile: new GetOwnProfile(accounts, deps.consents, audit, 'PROFILE_VIEWED'),
    getExtendedProfile: new GetOwnProfile(accounts, deps.consents, audit, 'PROFILE_EXTENDED_VIEWED'),
    getContact: new GetOwnContact(contacts, audit),
    getLocation: new GetOwnLocation(locations, audit),
    updateProfile: new UpdateOwnProfile(unitOfWork, accounts, persons, locations, catalogs, changeLog, audit, notices),
    updateEmail: new UpdateOwnEmail(unitOfWork, accounts, changeEmail, audit, notices),
    updatePhone: new UpdateOwnPhone(unitOfWork, contacts, identity, deps.verifications, changeLog, audit, notices, logger),
    updatePassword: new UpdateOwnPassword(unitOfWork, accounts, changeLog, audit, notices),
    updateNames: new UpdateOwnNames(unitOfWork, persons, changeLog, audit, notices),
    deleteAccount: new DeleteOwnAccount(unitOfWork, accounts, anonymize, audit, notices)
  });

  const referenceController = new PersonReferenceController({
    list: new ListReferences(references, audit),
    create: new CreateReference(references, audit),
    update: new UpdateReference(references, audit),
    remove: new RemoveReference(references, audit)
  });

  return {
    adminRouter: createAdminPersonRouter(adminController, deps.guards),
    profileRouter: createProfileRouter(profileController, deps.guards),
    clientRouter: createPersonReferenceRouter(referenceController, deps.guards),
    useCases: {
      executeClientAccountDeletion: executeDeletion,
      accountHolders: new AccountHolders(persons, contacts),
      identityChecks: identity,
      anonymizeAccount: anonymize
    }
  };
}
