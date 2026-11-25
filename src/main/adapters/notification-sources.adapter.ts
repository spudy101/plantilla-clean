// Adaptadores: lo que notification necesita de otros módulos. Viven acá porque conectan módulos; notification no
// los importa.
//
//   recipientDirectoryAdapter   RecipientDirectory con los usuarios de iam (contacto de un usuario, clientes del
//                               envío masivo)
//   phonePrefixesAdapter        PhonePrefixes con los prefijos telefónicos de catalogs
//
// Cuando iam se migre, esto llamará a sus casos de uso en vez de a su repositorio; notification no cambia.
import iamModule from '../../modules/iam';
import catalogsModule from '../../modules/catalogs';
import rbacModule from '../../shared/domain/constants/rbac';
import type { PhonePrefixes, RecipientDirectory } from '../../modules/notification/application/ports/recipient-directory.port';

const { CLIENT_ROLE_NAMES } = rbacModule;

export const recipientDirectoryAdapter: RecipientDirectory = {
  async findRecipient(userId) {
    const user = await iamModule.userRepository.findByUserId(userId, 'minimal');
    if (!user) {
      return null;
    }
    const contact = user.person?.contact ?? null;
    return {
      userId: user.userId,
      isActive: Boolean(user.isActive),
      email: contact?.email ?? null,
      phone: contact?.phonePrimary ? { number: contact.phonePrimary, prefixId: contact.phonePrimaryPrefixId ?? null } : null
    };
  },

  /** Solo clientes finales, nunca usuarios internos. */
  async activeClientsAfter(afterUserId, limit) {
    const users = await iamModule.userRepository.findActivePageByRoleNames(CLIENT_ROLE_NAMES, afterUserId, limit);
    return users.map(user => ({ userId: user.userId, email: user.person?.contact?.email ?? null }));
  }
};

export const phonePrefixesAdapter: PhonePrefixes = {
  async prefixOf(phonePrefixId) {
    return (await catalogsModule.phonePrefixRepository.findById(phonePrefixId))?.prefix ?? null;
  }
};
