// Casos de uso que usa iam (por los adaptadores de src/main/) para sus vistas admin: los intentos de autenticación
// (la vista de sesiones) y la bitácora de cambios de un usuario interno. No se auditan acá: los audita iam con la
// acción de su vista.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { AuditLogRepository, AuthAttemptCriteria } from '../ports/audit-log-repository.port';
import type { ChangeLogRepository } from '../ports/change-log-repository.port';

export class ListAuthAttemptRecords {
  constructor(private readonly logs: Pick<AuditLogRepository, 'findAuthAttempts'>) {}

  execute(criteria: AuthAttemptCriteria, page: PageRequest) {
    return this.logs.findAuthAttempts(criteria, page);
  }
}

export class ListAccountChangeHistory {
  constructor(private readonly changes: Pick<ChangeLogRepository, 'list'>) {}

  execute(userId: string, page: PageRequest) {
    return this.changes.list({ userId }, page, null);
  }
}
