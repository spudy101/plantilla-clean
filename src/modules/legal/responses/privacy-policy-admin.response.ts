import type { PageMetadata } from '../../../shared/application/pagination';
import { z } from '../../../shared/presentation/validation/z';
import { dateTime } from '../../../shared/presentation/validation/output';
import type { PrivacyPolicy } from '../../../shared/infrastructure/database/generated/prisma/client';


// ============================================================
// COMPONENTE BASE — un ítem de la lista o el detalle completo
// ============================================================

function PrivacyPolicyItemDTO(policy: PrivacyPolicy) {
  return {
    id: policy.privacyPolicyId,
    version: policy.version,
    isActive: policy.isActive,
    summary: policy.summary || null,
    effectiveDate: policy.effectiveDate,
    createdAt: policy.createdAt
  };
}

// ============================================================
// LIST — paginado
// ============================================================

function ListPrivacyPoliciesResponseDTO(policies: PrivacyPolicy[], metadata: PageMetadata) {
  return {
    data: Array.isArray(policies) ? policies.map(PrivacyPolicyItemDTO) : [],
    metadata
  };
}

// ============================================================
// DETAIL — incluye la URL pública del PDF
// ============================================================

function PrivacyPolicyDetailResponseDTO(policy: PrivacyPolicy) {
  return {
    id: policy.privacyPolicyId,
    version: policy.version,
    isActive: policy.isActive,
    summary: policy.summary || null,
    documentUrl: policy.documentUrl,
    effectiveDate: policy.effectiveDate,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt
  };
}

// ============================================================
// CREATE — respuesta tras publicar nueva versión
// ============================================================

function PrivacyPolicyCreatedResponseDTO(policy: PrivacyPolicy) {
  return {
    id: policy.privacyPolicyId,
    version: policy.version,
    isActive: policy.isActive,
    summary: policy.summary || null,
    documentUrl: policy.documentUrl,
    effectiveDate: policy.effectiveDate,
    createdAt: policy.createdAt
  };
}

// ============================================================
// ESQUEMAS DE SALIDA
// ============================================================

export const PrivacyPolicyItemSchema = z.object({
  id: z.uuid(),
  version: z.string().meta({ example: '1.1' }),
  isActive: z.boolean(),
  summary: z.string().nullable(),
  effectiveDate: dateTime(),
  createdAt: dateTime()
});
export const PrivacyPolicyDetailSchema = PrivacyPolicyItemSchema.extend({
  documentUrl: z.string().meta({ description: 'URL pública (CloudFront) del PDF.' }),
  updatedAt: dateTime().optional().meta({ description: 'Solo en el detalle (no en la respuesta de creación).' })
});

export default {
  ListPrivacyPoliciesResponseDTO,
  PrivacyPolicyDetailResponseDTO,
  PrivacyPolicyCreatedResponseDTO
};
