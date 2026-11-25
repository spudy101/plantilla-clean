// Adaptadores: lo que person necesita de otros módulos. Viven acá porque conectan módulos; person no los importa.
//
//   clientAccountsAdapter        ClientAccounts con los usuarios de iam
//   roleDirectoryAdapter         RoleDirectory con los roles de iam
//   profileCatalogsAdapter       ProfileCatalogs con catalogs (avatar, género, tipo de documento, departamento, ciudad)
//   contactVerificationsAdapter  ContactVerifications con los códigos OTP de notification
//   profileConsentsAdapter       ProfileConsents con legal (catálogo de consentimientos del perfil, revocación)
//   dualApprovalGateAdapter      DualApprovalGate con el gate de approvals (que ya está en Clean)
//
// Cuando iam y notification se migren, estos adaptadores llamarán a sus casos de uso en vez de a sus
// repositorios y servicios; person no cambia.
import iamModule from '../../modules/iam';
import catalogsModule from '../../modules/catalogs';
import notificationModule from '../../modules/notification';
import legalModule from '../../modules/legal';
import type { ClientAccounts, RoleDirectory } from '../../modules/person/application/ports/client-accounts.port';
import type { ProfileCatalogs } from '../../modules/person/application/ports/profile-catalogs.port';
import type { ContactVerifications } from '../../modules/person/application/ports/contact-verifications.port';
import type { ProfileConsents } from '../../modules/person/application/ports/profile-consents.port';
import type { DualApprovalGate } from '../../modules/person/application/ports/dual-approval.port';
import type { GateOperation } from '../../modules/approvals/application/use-cases/gate-operation.use-case';

export const clientAccountsAdapter: ClientAccounts = {
  findProfile: userId => iamModule.userRepository.findByUserId(userId, 'full'),

  list: (filters, page, search) => iamModule.userRepository.findAllPaginated(filters, page, search),

  findTarget: userId => iamModule.userRepository.findAdminTarget(userId),

  async findSummary(userId) {
    const user = await iamModule.userRepository.findByUserId(userId, 'minimal');
    return user ? { userId: user.userId, username: user.username, firstName: user.person?.firstName ?? null } : null;
  },

  async passwordMatches(userId, plainPassword) {
    const user = await iamModule.userRepository.findById(userId);
    return iamModule.userRepository.verifyPassword(plainPassword, user?.passwordHash ?? null);
  },

  async findUserIdByUsername(username) {
    return (await iamModule.userRepository.findByUsername(username))?.userId ?? null;
  },

  async create(account) {
    const { userId } = await iamModule.userRepository.createWithPassword(account);
    return { userId };
  },

  async updateProfile(userId, changes) {
    await iamModule.userRepository.update(userId, changes);
  },

  async setPassword(userId, plainPassword) {
    await iamModule.userRepository.updatePassword(userId, plainPassword);
  },

  async setActive(userId, isActive) {
    await iamModule.userRepository.setActiveStatus(userId, isActive);
  },

  async setRole(userId, roleId) {
    await iamModule.userRepository.update(userId, { roleId });
  },

  async shutDownMfa(userId, { clearTotpSecret, ...flags }) {
    await iamModule.userRepository.update(userId, { ...flags, ...(clearTotpSecret ? { totpSecret: null } : {}) });
  },

  async markDeleted(userId, anonymizedUsername, at) {
    await iamModule.userRepository.update(userId, { username: anonymizedUsername, isActive: false, deletedAt: at });
  }
};

export const roleDirectoryAdapter: RoleDirectory = {
  findById: roleId => iamModule.roleRepository.findById(roleId),
  findByName: name => iamModule.roleRepository.findByName(name),
  findByNames: names => iamModule.roleRepository.findByNames(names)
};

export const profileCatalogsAdapter: ProfileCatalogs = {
  findAvatar: avatarId => catalogsModule.avatarRepository.findById(avatarId),
  findGender: genderId => catalogsModule.genderRepository.findById(genderId),
  findDocumentType: documentTypeId => catalogsModule.documentTypeRepository.findById(documentTypeId),
  findDepartment: departmentId => catalogsModule.departmentRepository.findById(departmentId),
  findCity: cityId => catalogsModule.cityRepository.findById(cityId)
};

export const contactVerificationsAdapter: ContactVerifications = {
  async isVerified(kind, value) {
    return (await notificationModule.verificationCodeRepository.findVerifiedByContact(kind, value)) !== null;
  },
  async consume(kind, value) {
    await notificationModule.verificationCodeRepository.deleteVerifiedByContact(kind, value);
  }
};

export const profileConsentsAdapter: ProfileConsents = {
  /** Todos los tipos activos con el estado del titular en cada uno (granted true/false). */
  async catalogFor(userId) {
    const [types, consents] = await Promise.all([
      legalModule.consentTypeRepository.listActive(),
      legalModule.userConsentRepository.findCurrentByUser(userId)
    ]);
    const { UserConsentComponent } = legalModule.legalComponentsDto;
    const grantedByType = new Map(consents.map(c => [c.consentTypeId, c]));
    return types.map(type => UserConsentComponent.buildClientCatalogItem(type, grantedByType.get(type.consentTypeId) || null));
  },

  async revokeAll(userId) {
    await legalModule.userConsentRepository.revokeAll(userId);
  }
};

export const dualApprovalGateAdapter = (gate: GateOperation): DualApprovalGate => ({
  async gate(operationKey, args) {
    const result = await gate.execute(operationKey, args);
    return result.pending ? { pending: true, request: result.request } : { pending: false };
  }
});
