// API pública del módulo approvals: lo ÚNICO que otros módulos (y src/app.ts) pueden importar.
// Lo que no está acá es interno del módulo (docs/ARCHITECTURE.md, regla 2).
//
// Cada export se carga al usarse (getter): los módulos se usan entre sí y un index que cargara todo
// de una vez crearía ciclos de carga. Uso: import approvalsModule from '…/approvals'; const { X } = approvalsModule;
import { interopDefault } from '../../shared/kernel/interop.util';

export default {
  get dualApprovalBootstrap() {
    return interopDefault(require('./dual-approval.bootstrap') as typeof import('./dual-approval.bootstrap'));
  },

  get approvalRequestRepository() {
    return interopDefault(require('./repositories/approval-request.repository') as typeof import('./repositories/approval-request.repository'));
  },

  get adminApprovalRequestRoutes() {
    return interopDefault(require('./routes/approval-request.routes') as typeof import('./routes/approval-request.routes'));
  },

  get DualApprovalService() {
    return interopDefault(require('./services/dual-approval.service') as typeof import('./services/dual-approval.service'));
  },

  get DualApprovalExpirationWorker() {
    return interopDefault(require('./workers/dual-approval-expiration.worker') as typeof import('./workers/dual-approval-expiration.worker'));
  }
};
