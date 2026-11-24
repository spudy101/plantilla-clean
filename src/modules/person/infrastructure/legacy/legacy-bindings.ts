// @deprecated TRANSITORIO: los casos de uso de person que iam (todavía sin migrar) usa por el index.ts.
//
// Algunos necesitan adaptadores de otros módulos (las cuentas de iam, los consentimientos de legal, la
// bitácora de audit), que solo existen en el composition root. person.module.ts los deja acá al armarse; el
// index los busca al usarse. Cuando iam se migre, recibirá estos casos de uso por el container y esto se borra.
import type { AccountChangeLog } from '../../application/ports/account-change-log.port';
import type { AnonymizeAccount } from '../../application/use-cases/anonymize-account.use-case';

export interface LegacyBindings {
  anonymizeAccount: AnonymizeAccount;
  changeLog: AccountChangeLog;
}

let bindings: LegacyBindings | null = null;

export function bindLegacyPerson(next: LegacyBindings): void {
  bindings = next;
}

export function legacyBindings(): LegacyBindings {
  if (!bindings) {
    throw new Error('El módulo person no está armado: src/main/container.ts (createContainer) todavía no corrió');
  }
  return bindings;
}
