// Adaptador Prisma del puerto AuditAlertRepository. audit_alerts no declara relación con users (user_id es
// trazabilidad: puede quedar huérfano), así que el actor y quien reconoció se resuelven por lote.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { AuditAlert, AuditAlertRisk, Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import { loadUserRefs } from '../../../../shared/infrastructure/database/user-ref';
import type { AuditAlertFilters, AuditAlertRepository } from '../../application/ports/audit-alert-repository.port';
import type { Page } from '../../application/ports/audit-log-repository.port';
import type { AuditAlertEntry, NewAuditAlert } from '../../domain/audit-log';
import { AuditMapper } from './audit.mapper';

export class PrismaAuditAlertRepository extends PrismaRepository implements AuditAlertRepository {
  async create(alert: NewAuditAlert, { independent }: { independent: boolean }): Promise<void> {
    const db = independent ? this.independentDb() : await this.db();
    await db.auditAlert.create({ data: { ...alert, risk: alert.risk as AuditAlertRisk } });
  }

  async findById(alertId: string): Promise<AuditAlertEntry | null> {
    const row = await (await this.db()).auditAlert.findUnique({ where: { auditAlertId: alertId } });
    return row ? (await this.withUsers([row]))[0]! : null;
  }

  async list({ acknowledged, dateFrom, dateTo, action, category }: AuditAlertFilters, page: PageRequest): Promise<Page<AuditAlertEntry>> {
    const where: Prisma.AuditAlertWhereInput = {
      ...(typeof acknowledged === 'boolean' ? { acknowledged } : {}),
      ...(action ? { action } : {}),
      ...(category ? { category } : {}),
      ...(dateFrom != null || dateTo != null
        ? { createdAt: { ...(dateFrom != null ? { gte: dateFrom } : {}), ...(dateTo != null ? { lte: dateTo } : {}) } }
        : {})
    };
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.auditAlert.findMany({ where, ...this.paginationArgs(page, 'auditAlertId') }),
      db.auditAlert.count({ where })
    ]);
    return { rows: await this.withUsers(rows), count };
  }

  async countPending(): Promise<number> {
    return (await this.db()).auditAlert.count({ where: { acknowledged: false } });
  }

  async acknowledge(alertIds: string[], acknowledgedBy: string): Promise<number> {
    const { count } = await (await this.db()).auditAlert.updateMany({
      where: { auditAlertId: { in: alertIds }, acknowledged: false },
      data: { acknowledged: true, acknowledgedBy, acknowledgedAt: new Date() }
    });
    return count;
  }

  private async withUsers(rows: AuditAlert[]): Promise<AuditAlertEntry[]> {
    const users = await loadUserRefs(await this.db(), rows.flatMap(r => [r.userId, r.acknowledgedBy]));
    return rows.map(r => AuditMapper.auditAlertToDomain(r, users));
  }
}
