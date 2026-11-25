// Caso de uso: las solicitudes pendientes sobre una lista de entidades de otro módulo, en una sola consulta (el
// badge "pendiente de aprobación" de sus listados).
import type { ApprovalRequestRepository } from '../ports/approval-request-repository.port';
import { toPendingApprovalOutput, type PendingApprovalOutput } from '../dto/approval-request.output';

export class FindPendingApprovals {
  constructor(private readonly requests: ApprovalRequestRepository) {}

  /** Por id de entidad, su pendiente; las entidades sin pendiente no aparecen. */
  async execute(entityType: string, entityIds: string[]): Promise<Map<string, PendingApprovalOutput>> {
    const pending = entityIds.length > 0 ? await this.requests.findPendingByEntityIds(entityType, entityIds) : [];
    const byEntityId = new Map<string, PendingApprovalOutput>();
    for (const request of pending) {
      if (request.entityId) {
        byEntityId.set(request.entityId, toPendingApprovalOutput(request));
      }
    }
    return byEntityId;
  }
}
