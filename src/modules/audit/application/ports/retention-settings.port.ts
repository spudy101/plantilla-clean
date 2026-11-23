// Puerto: la política de retención vigente (la configura el Superadmin en settings). src/main/ lo implementa
// con el caso de uso GetAuditRetention de settings.
import type { RetentionSettings } from '../../domain/retention';

export interface RetentionSettingsReader {
  /** null si no hay configuración activa. */
  read(): Promise<RetentionSettings | null>;
}
