// Esquemas globales del núcleo, generados desde los esquemas Zod de los módulos.
//   PendingApproval — doble aprobación pendiente sobre una entidad. La anotan varios listados/detalles admin
//                     (FindPendingApprovals de approvals); null cuando no hay solicitud pendiente.
import { toOpenApi } from '../../../shared/presentation/validation/openapi';
import { PendingApprovalSchema } from '../../../modules/approvals/presentation/http/responses/approval-request.response';

export default {
  PendingApproval: toOpenApi(PendingApprovalSchema, 'output')
};
