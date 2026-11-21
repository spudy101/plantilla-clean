// shared/database/pii-fields.ts
//
// Columnas cifradas en reposo (AES-256-GCM, EncryptionUtil) y, las que se buscan, con su hash
// determinístico (HMAC-SHA256 con pepper, HashUtil) en una columna aparte. Nombres de los campos de
// Prisma. Es lo mismo que hacen hoy los hooks de los modelos de Sequelize (person, person-contact,
// user-trusted-device) y con las mismas funciones: lo que escribe un ORM lo lee el otro
// (docs/prisma-migration.md, fase 4).
//
// Columna nueva cifrada → agregarla acá (y en shared/constants/pii-fields.ts si además se enmascara al
// mostrarla). Otras columnas cifradas por la app a mano (totp_secret, códigos de verificación…) no
// están acá: las cifra y descifra su service.
import EncryptionUtil from '../security/encryption.util';
import HashUtil from '../security/hash.util';

export interface EncryptedField {
  /** Campo de Prisma que guarda el cifrado. */
  field: string;
  /** Campo de Prisma con el hash de búsqueda (si se busca por igualdad). */
  hash?: string;
}

/** Por modelo de Prisma. */
export const ENCRYPTED_FIELDS: Readonly<Record<string, readonly EncryptedField[]>> = {
  Person: [{ field: 'nationalId', hash: 'nationalIdHash' }],
  PersonContact: [
    { field: 'email', hash: 'emailHash' },
    { field: 'phonePrimary', hash: 'phonePrimaryHash' },
    { field: 'phoneSecondary', hash: 'phoneSecondaryHash' }
  ],
  UserTrustedDevice: [{ field: 'hmacSecret' }]
};

/** Cifra un valor en claro (mismo formato que los hooks de Sequelize). */
export function sealValue(plain: string): string {
  return EncryptionUtil.encrypt(plain);
}

/** Hash de búsqueda de un valor en claro (mismo que usan los repositorios para filtrar). */
export function hashValue(plain: string): string | null {
  return HashUtil.hashForSearch(plain);
}

/**
 * Descifra un valor leído de la base. Si no se puede (dato legacy guardado en claro), lo devuelve tal
 * cual: mismo criterio que el afterFind de los modelos de Sequelize.
 */
export function openValue(stored: string): string {
  try {
    return EncryptionUtil.decrypt(stored);
  } catch {
    return stored;
  }
}

export default { ENCRYPTED_FIELDS, sealValue, hashValue, openValue };
