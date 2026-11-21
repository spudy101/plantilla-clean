// modules/schemas/records/audit/repositories/audit-alert.repository.ts
//
// Alertas de auditoría para el superadmin. Las crea audit.record() junto con el registro que las dispara.
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { PageRequest } from '../../../shared/http/pagination';
import type { AuditAlert, Prisma } from '../../../shared/database/generated/prisma/client';
import { loadUserRefs } from './user-ref';
import type { UserRef } from './user-ref';

/** Alerta con quién la originó (actor) y quién la reconoció. */
export type AuditAlertWithUsers = AuditAlert & { actor: UserRef | null; acknowledgedByUser: UserRef | null };

class AuditAlertRepository extends PrismaRepository {
  /** Misma regla que la auditoría: dentro de la transacción en curso salvo `independent`. */
  async create(data: Prisma.AuditAlertUncheckedCreateInput, { independent = false } = {}): Promise<AuditAlert> {
    const db = independent ? this.independentDb() : await this.db();
    return db.auditAlert.create({ data });
  }

  async findById(alertId: string): Promise<AuditAlertWithUsers | null> {
    const row = await (await this.db()).auditAlert.findUnique({ where: { auditAlertId: alertId } });
    return row ? (await this.attachUsers([row]))[0]! : null;
  }

  async findAllFiltered(
    { acknowledged, dateFrom, dateTo, action, category }: AuditAlertRepository.Filters = {},
    page: PageRequest
  ): Promise<PrismaRepository.Page<AuditAlertWithUsers>> {
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
    return { rows: await this.attachUsers(rows), count };
  }

  /** Reconoce una alerta pendiente; devuelve cuántas filas cambió (0 si no existía o ya estaba reconocida). */
  acknowledge(alertId: string, acknowledgedBy: string): Promise<number> {
    return this.acknowledgeBulk([alertId], acknowledgedBy);
  }

  /** Reconoce las alertas pendientes indicadas; devuelve cuántas cambió. */
  async acknowledgeBulk(alertIds: string[], acknowledgedBy: string): Promise<number> {
    const { count } = await (await this.db()).auditAlert.updateMany({
      where: { auditAlertId: { in: alertIds }, acknowledged: false },
      data: { acknowledged: true, acknowledgedBy, acknowledgedAt: new Date() }
    });
    return count;
  }

  async countPending(): Promise<number> {
    return (await this.db()).auditAlert.count({ where: { acknowledged: false } });
  }

  private async attachUsers(rows: AuditAlert[]): Promise<AuditAlertWithUsers[]> {
    const users = await loadUserRefs(await this.db(), rows.flatMap(r => [r.userId, r.acknowledgedBy]));
    return rows.map(r => ({
      ...r,
      actor: (r.userId && users.get(r.userId)) || null,
      acknowledgedByUser: (r.acknowledgedBy && users.get(r.acknowledgedBy)) || null
    }));
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace AuditAlertRepository {
  export interface Filters {
    acknowledged?: boolean;
    dateFrom?: Date | string;
    dateTo?: Date | string;
    action?: string;
    category?: string;
  }
}

export default new AuditAlertRepository();
