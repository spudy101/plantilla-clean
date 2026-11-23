// Puerto de persistencia de las alertas de auditoría para el Superadmin. Lo implementa
// infrastructure/persistence/prisma-audit-alert.repository.ts.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { AuditAlertEntry, NewAuditAlert } from '../../domain/audit-log';
import type { Page } from './audit-log-repository.port';

export interface AuditAlertFilters {
  acknowledged?: boolean;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  action?: string;
  category?: string;
}

export interface AuditAlertRepository {
  /** Misma regla que el registro: dentro de la unidad de trabajo en curso salvo `independent`. */
  create(alert: NewAuditAlert, options: { independent: boolean }): Promise<void>;

  findById(alertId: string): Promise<AuditAlertEntry | null>;
  list(filters: AuditAlertFilters, page: PageRequest): Promise<Page<AuditAlertEntry>>;
  countPending(): Promise<number>;

  /** Reconoce las alertas pendientes indicadas; devuelve cuántas cambió (las ya reconocidas no cuentan). */
  acknowledge(alertIds: string[], acknowledgedBy: string): Promise<number>;
}
