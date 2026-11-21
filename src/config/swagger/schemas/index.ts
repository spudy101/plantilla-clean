// Esquemas globales: los components.schemas que comparten los specs admin y client. Todos se generan desde los
// esquemas Zod de shared/validation y de cada módulo (responses/): acá no se escribe ningún esquema a mano.
// Los esquemas propios de cada endpoint viven en el docs/ de su módulo.
//
// [RF-USR-01] | CA-06 — En las RESPUESTAS, documento, correo, teléfono y TIN salen enmascarados; los textos
// compartidos están en shared/validation/pii-masking.doc.ts. Los REQUESTS van siempre completos.
import { toOpenApi } from '../../../shared/validation/openapi';
import { PaginationMetadata } from '../../../shared/validation/output';
import kycSchemas from './kyc.schema';
import coreSchemas from './core.schema';
import notificationSchemas from './notification.schema';

export default {
  Metadata: toOpenApi(PaginationMetadata, 'output'),
  ...kycSchemas,
  ...coreSchemas,
  ...notificationSchemas
};
