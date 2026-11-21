// Esquemas globales del núcleo, generados desde los esquemas Zod de los módulos.
//   PendingApproval — doble aprobación pendiente sobre una entidad. La anotan varios listados/detalles admin
//                     (DualApprovalService.annotatePending); null cuando no hay solicitud pendiente.
import { toOpenApi } from '../../../shared/presentation/validation/openapi';
import { PendingApprovalSchema } from '../../../modules/approvals/responses/approval-components.response';

export default {
  PendingApproval: toOpenApi(PendingApprovalSchema, 'output')
};
