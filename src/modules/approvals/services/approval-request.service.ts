import type { AdminAuditContext } from '../../../shared/application/audit-context';
// Service del módulo admin de doble aprobación. Delega en el core DualApprovalService
// (capa de datos en schemas/core) y agrega la auditoría de los endpoints admin.

import DualApprovalService from './dual-approval.service';
import auditModule from '../../audit';
import type { ApprovalListQuery } from '../requests/approval-request.request';
const { audit } = auditModule;

const ENTITY = { entityType: 'ApprovalRequest', entityTable: 'approval_requests' };

class ApprovalRequestService {
  DualApprovalService: typeof DualApprovalService;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new ApprovalRequestService({ DualApprovalService: fake })
   * @param {object} [deps]
   */
  constructor(deps: ApprovalRequestService.Deps = {}) {
    this.DualApprovalService = deps.DualApprovalService ?? DualApprovalService;
  }

  async list(query: ApprovalListQuery, adminUserId: string) {
    const result = await this.DualApprovalService.list(query);
    await audit.record('APPROVAL_REQUEST_LIST_VIEWED', {
      actorId: adminUserId,
      details: { operationKey: query.operationKey ?? null, status: query.status ?? null },
      ...ENTITY
    });
    return result;
  }

  async getById(id: string, adminUserId: string) {
    const data = await this.DualApprovalService.getById(id);
    await audit.record('APPROVAL_REQUEST_VIEWED', { actorId: adminUserId, entityId: id, ...ENTITY });
    return data;
  }

  async getPolicy(adminUserId: string) {
    const data = await this.DualApprovalService.getPolicy();
    await audit.record('APPROVAL_POLICY_VIEWED', { actorId: adminUserId, ...ENTITY });
    return data;
  }

  // El core ya audita DUAL_APPROVAL_APPROVED / DUAL_APPROVAL_REJECTED y valida rol + segregación.
  // eslint-disable-next-line class-methods-use-this
  resolve(id: string, body: { decision: string; notes?: string | null }, approverCtx: AdminAuditContext) {
    return this.DualApprovalService.resolve(id, body, approverCtx);
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace ApprovalRequestService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    DualApprovalService?: typeof DualApprovalService;
  }
}

export default Object.assign(new ApprovalRequestService(), { ApprovalRequestService });
