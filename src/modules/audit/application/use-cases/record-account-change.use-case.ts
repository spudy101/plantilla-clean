// Caso de uso: dejar en la bitácora un cambio sobre una cuenta (USER_FIELD_CHANGED con el valor anterior y
// el nuevo). Lo usan iam y person.
import { ACCOUNT_CHANGE_ACTION, accountChangeFact, type AccountChange } from '../../domain/account-change';
import type { RecordAuditEvent } from './record-audit-event.use-case';

export class RecordAccountChange {
  constructor(private readonly recordEvent: RecordAuditEvent) {}

  execute(change: AccountChange): Promise<void> {
    return this.recordEvent.execute(ACCOUNT_CHANGE_ACTION, accountChangeFact(change));
  }
}
