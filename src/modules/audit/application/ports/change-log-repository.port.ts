// Puerto de lectura de la bitácora de cambios de cuentas (una vista sobre audit_logs: acción
// USER_FIELD_CHANGED). Lo implementa infrastructure/persistence/prisma-change-log.repository.ts.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { ChangedByRole, ChangeLogWithUsers, ChangeType } from '../../domain/account-change';
import type { ExternalChange } from '../../domain/activity-feed';
import type { Page } from './audit-log-repository.port';

export interface ChangeLogFilters {
  userId?: string;
  changedByUserId?: string;
  changeType?: ChangeType;
  changedByRole?: ChangedByRole;
  changedByRoles?: readonly ChangedByRole[];
  dateFrom?: Date | string;
  dateTo?: Date | string;
}

export interface ChangeLogRepository {
  /** Con el usuario afectado y quién hizo el cambio; `search` busca en motivo y valores. */
  list(filters: ChangeLogFilters, page: PageRequest, search: string | null): Promise<Page<ChangeLogWithUsers>>;

  /** Cambios hechos sobre la cuenta por alguno de `roles`, del más reciente al más antiguo, sin valores. */
  findChangesBy(userId: string, roles: readonly ChangedByRole[], window: { limit: number; offset: number }): Promise<Page<ExternalChange>>;
}
