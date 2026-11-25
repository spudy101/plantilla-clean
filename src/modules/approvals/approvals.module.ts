// Composición del módulo approvals: el ÚNICO archivo del módulo que conoce todas sus capas.
//
//   Prisma (solicitudes) ──► casos de uso ──► controller ──► router admin
//                               ▲    │
//   otros módulos: gate ────────┘    └──► handlers registrados (la acción real, al aprobar)
//
// Lo que viene de afuera (auditoría, avisos, logger, guardas, aprobadores de iam, umbrales de settings) llega por
// parámetro desde src/main/. Las reanudaciones las registra el container con `handlers.register(...)`.
import type { Router } from 'express';
import type { AuditTrail } from '../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../shared/application/ports/logger.port';
import type { Notifier } from '../../shared/application/ports/notifier.port';
import type { RouteGuards } from '../../shared/presentation/http/route-guards';
import type { ApproverDirectory } from './application/ports/approver-directory.port';
import type { ApprovalThresholds } from './application/ports/approval-thresholds.port';
import { PrismaApprovalRequestRepository } from './infrastructure/persistence/prisma-approval-request.repository';
import { createDualApprovalExpirationWorker, type DualApprovalExpirationWorker } from './infrastructure/workers/dual-approval-expiration.worker';
import { bindLegacyApprovals } from './infrastructure/legacy/dual-approval';
import { ApprovalHandlers } from './application/use-cases/approval-handlers';
import { ApprovalNotices } from './application/use-cases/approval-notices';
import { GateOperation } from './application/use-cases/gate-operation.use-case';
import { ResolveApprovalRequest } from './application/use-cases/resolve-approval-request.use-case';
import { GetApprovalPolicy, GetApprovalRequest, ListApprovalRequests } from './application/use-cases/approval-request-queries.use-cases';
import { FindPendingApprovals } from './application/use-cases/pending-approvals.use-case';
import { ExpireApprovalRequests } from './application/use-cases/expire-approval-requests.use-case';
import { ApprovalRequestController } from './presentation/http/approval-request.controller';
import { createApprovalRequestRouter } from './presentation/http/approval-request.routes';
import { createRequireDualApproval, type RequireDualApproval } from './presentation/http/dual-approval.middleware';

export interface ApprovalsModuleDeps {
  audit: AuditTrail;
  notifier: Notifier;
  logger: Logger;
  guards: RouteGuards;
  /** Los usuarios activos con un rol aprobador (iam). */
  approvers: ApproverDirectory;
  /** El umbral configurado de las operaciones THRESHOLD (settings). */
  thresholds: ApprovalThresholds;
  /** Logo de las plantillas de correo. */
  notificationLogoUrl: string | null | undefined;
}

export interface ApprovalsModule {
  /** Rutas de administración (se montan bajo /admin/api/v1/core). */
  adminRouter: Router;
  /** Donde cada módulo registra la reanudación de su operación gateada. */
  handlers: ApprovalHandlers;
  useCases: {
    /** El gate que usan los módulos con operaciones gateadas. */
    gate: GateOperation;
    /** Las pendientes sobre una lista de entidades (badge en listados). */
    findPending: FindPendingApprovals;
  };
  /** El gate como middleware de ruta, para operaciones que se deciden con la petición. */
  requireDualApproval: RequireDualApproval;
  /** Vence las solicitudes con el plazo pasado (lo inicia src/main/server.ts). */
  expirationWorker: DualApprovalExpirationWorker;
}

export function createApprovalsModule(deps: ApprovalsModuleDeps): ApprovalsModule {
  const { audit, logger } = deps;
  const requests = new PrismaApprovalRequestRepository();
  const handlers = new ApprovalHandlers();
  const notices = new ApprovalNotices(deps.approvers, deps.notifier, logger, deps.notificationLogoUrl);

  const gate = new GateOperation(requests, deps.thresholds, notices, audit, logger);
  const findPending = new FindPendingApprovals(requests);

  const controller = new ApprovalRequestController(
    new ListApprovalRequests(requests, audit),
    new GetApprovalRequest(requests, audit),
    new GetApprovalPolicy(deps.thresholds, audit, logger),
    new ResolveApprovalRequest(requests, handlers, notices, audit)
  );

  // Transitorio: lo que iam usa por el index.ts
  bindLegacyApprovals({
    gate: (operationKey, input) => gate.execute(operationKey, input),
    findPending: (entityType, entityIds) => findPending.execute(entityType, entityIds)
  });

  return {
    adminRouter: createApprovalRequestRouter(controller, deps.guards),
    handlers,
    useCases: { gate, findPending },
    requireDualApproval: createRequireDualApproval(gate),
    expirationWorker: createDualApprovalExpirationWorker(new ExpireApprovalRequests(requests, audit, logger), logger)
  };
}
