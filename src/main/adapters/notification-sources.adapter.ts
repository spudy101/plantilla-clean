// Adaptadores: lo que notification necesita de otros módulos. Viven acá porque conectan módulos; notification no
// los importa.
//
//   recipientDirectory   RecipientDirectory con las cuentas de iam (contacto de un usuario, clientes del envío masivo)
//   phonePrefixes        PhonePrefixes con los prefijos telefónicos de catalogs
import type { PhonePrefixes, RecipientDirectory } from '../../modules/notification/application/ports/recipient-directory.port';
import type { ModuleRegistry } from './module-registry';

export function recipientDirectoryAdapter(modules: ModuleRegistry): RecipientDirectory {
  return {
    findRecipient: userId => modules.iam.directories.accounts.findRecipient(userId),
    /** Solo clientes finales, nunca usuarios internos. */
    activeClientsAfter: (afterUserId, limit) => modules.iam.directories.accounts.activeClientsAfter(afterUserId, limit)
  };
}

export function phonePrefixesAdapter(modules: ModuleRegistry): PhonePrefixes {
  return {
    async prefixOf(phonePrefixId) {
      return (await modules.catalogs.lookups.phonePrefix.execute(phonePrefixId))?.prefix ?? null;
    }
  };
}
