// Puerto: la bitácora de cambios de una cuenta (valor anterior → valor nuevo). La lleva audit.

export type AccountChangeType =
  | 'email'
  | 'password'
  | 'mfa_status'
  | 'account_status'
  | 'role'
  | 'national_id'
  | 'name'
  | 'gender'
  | 'location'
  | 'phone'
  | 'birth_date';

export interface AccountChangeEntry {
  /** La cuenta que cambia. */
  userId: string;
  /** Quién la cambió. */
  changedByUserId: string;
  changedByRole: 'admin' | 'user' | 'system';
  changeType: AccountChangeType;
  previousValue: string | null;
  newValue: string | null;
  changeReason?: string | null;
}

export interface AccountChangeLog {
  record(change: AccountChangeEntry): Promise<void>;
}
