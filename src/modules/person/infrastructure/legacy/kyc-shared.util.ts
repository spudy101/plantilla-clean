// @deprecated TRANSITORIO: lo que iam usaba del viejo KycSharedUtil (contraseñas temporales y la bitácora de
// cambios de la cuenta). Se borra al migrar iam.
import type { AccountChangeEntry } from '../../application/ports/account-change-log.port';
import { generateSecurePassword } from '../security/secure-password.generator';
import { legacyBindings } from './legacy-bindings';

/** Un cambio sobre la cuenta tal como lo arma iam (ip y user-agent se ignoran: salen del contexto). */
export interface LegacyAccountChange extends Omit<AccountChangeEntry, 'changeType' | 'changedByUserId' | 'previousValue' | 'newValue'> {
  changeType: string;
  changedByUserId?: string | null;
  previousValue?: string | null;
  newValue?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export default {
  generateSecurePassword,

  /** Registra un cambio sobre la cuenta en la bitácora (audit_logs, acción USER_FIELD_CHANGED). */
  logChange({ ipAddress: _ip, userAgent: _ua, ...change }: LegacyAccountChange): Promise<void> {
    return legacyBindings().changeLog.record(change as AccountChangeEntry);
  }
};
