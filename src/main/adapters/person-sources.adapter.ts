// Adaptadores: lo que person necesita de otros módulos. Viven acá porque conectan módulos; person no los importa.
//
//   clientAccounts               ClientAccounts con las cuentas de iam
//   roleDirectory                RoleDirectory con los roles de iam
//   profileCatalogs              ProfileCatalogs con catalogs (avatar, género, tipo de documento, departamento, ciudad)
//   contactVerifications         ContactVerifications con los códigos OTP de notification
//   profileConsents              ProfileConsents con legal (catálogo de consentimientos del perfil, revocación)
//   dualApprovalGate             DualApprovalGate con el gate de approvals
import type { ClientAccounts, RoleDirectory } from '../../modules/person/application/ports/client-accounts.port';
import type { ProfileCatalogs } from '../../modules/person/application/ports/profile-catalogs.port';
import type { ContactVerifications } from '../../modules/person/application/ports/contact-verifications.port';
import type { ProfileConsents } from '../../modules/person/application/ports/profile-consents.port';
import type { DualApprovalGate } from '../../modules/person/application/ports/dual-approval.port';
import type { ModuleRegistry } from './module-registry';

export function clientAccountsAdapter(modules: ModuleRegistry): ClientAccounts {
  const accounts = () => modules.iam.directories.accounts;
  return {
    findProfile: userId => accounts().findProfile(userId),
    list: (filters, page, search) => accounts().list(filters, page, search),
    findTarget: userId => accounts().findTarget(userId),
    findSummary: userId => accounts().findSummary(userId),
    passwordMatches: (userId, plainPassword) => accounts().passwordMatches(userId, plainPassword),
    findUserIdByUsername: username => accounts().findUserIdByUsername(username),
    create: account => accounts().create(account),
    updateProfile: (userId, changes) => accounts().update(userId, changes),
    setPassword: (userId, plainPassword) => accounts().setPassword(userId, plainPassword),
    setActive: (userId, isActive) => accounts().update(userId, { isActive }),
    setRole: (userId, roleId) => accounts().update(userId, { roleId }),
    shutDownMfa: (userId, { clearTotpSecret, ...flags }) => accounts().update(userId, { ...flags, ...(clearTotpSecret ? { totpSecret: null } : {}) }),
    markDeleted: (userId, anonymizedUsername, at) => accounts().update(userId, { username: anonymizedUsername, isActive: false, deletedAt: at })
  };
}

export function roleDirectoryAdapter(modules: ModuleRegistry): RoleDirectory {
  return {
    findById: roleId => modules.iam.directories.roles.findById(roleId),
    findByName: name => modules.iam.directories.roles.findByName(name),
    findByNames: names => modules.iam.directories.roles.findByNames(names)
  };
}

export function profileCatalogsAdapter(modules: ModuleRegistry): ProfileCatalogs {
  return {
    findAvatar: avatarId => modules.catalogs.lookups.avatar.execute(avatarId),
    findGender: genderId => modules.catalogs.lookups.gender.execute(genderId),
    findDocumentType: documentTypeId => modules.catalogs.lookups.documentType.execute(documentTypeId),
    findDepartment: departmentId => modules.catalogs.lookups.department.execute(departmentId),
    findCity: cityId => modules.catalogs.lookups.city.execute(cityId)
  };
}

export function contactVerificationsAdapter(modules: ModuleRegistry): ContactVerifications {
  return {
    isVerified: (kind, value) => modules.notification.useCases.otpCodes.isVerified(kind, value),
    consume: (kind, value) => modules.notification.useCases.otpCodes.consumeVerified(kind, value)
  };
}

export function profileConsentsAdapter(modules: ModuleRegistry): ProfileConsents {
  return {
    /** Todos los tipos activos con el estado del titular en cada uno (granted true/false). */
    catalogFor: userId => modules.legal.useCases.getConsentCatalog.execute(userId),
    revokeAll: userId => modules.legal.useCases.revokeAllConsents.execute(userId)
  };
}

export function dualApprovalGateAdapter(modules: ModuleRegistry): DualApprovalGate {
  return {
    async gate(operationKey, args) {
      const result = await modules.approvals.useCases.gate.execute(operationKey, args);
      return result.pending ? { pending: true, request: result.request } : { pending: false };
    }
  };
}
