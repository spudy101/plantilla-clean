// Lo que notification necesita de otros módulos para saber a quién y adónde mandar: las cuentas y su contacto
// (iam) y los prefijos telefónicos (catalogs). Los implementa src/main/adapters/notification-sources.adapter.ts.
import type { BroadcastRecipient } from '../../domain/broadcast';

export interface Recipient {
  userId: string;
  isActive: boolean;
  email: string | null;
  /** Teléfono principal (número local) y el id de su prefijo. */
  phone: { number: string; prefixId: string | null } | null;
}

export interface RecipientDirectory {
  findRecipient(userId: string): Promise<Recipient | null>;
  /** Los clientes activos (nunca usuarios internos) después de `afterUserId`, por user_id, de a `limit`. */
  activeClientsAfter(afterUserId: string | null, limit: number): Promise<BroadcastRecipient[]>;
}

export interface PhonePrefixes {
  /** El prefijo del país (p. ej. '+56'), o null si no existe. */
  prefixOf(phonePrefixId: string): Promise<string | null>;
}
