// Lo que devuelven los casos de uso del mantenedor de políticas de privacidad. El id sale como `id` (no
// privacyPolicyId): es el contrato de la API de siempre.
import type { PrivacyPolicy } from '../../domain/privacy-policy';

export const toPrivacyPolicyItemOutput = (policy: PrivacyPolicy) => ({
  id: policy.privacyPolicyId,
  version: policy.version,
  isActive: policy.isActive,
  summary: policy.summary || null,
  effectiveDate: policy.effectiveDate,
  createdAt: policy.createdAt
});
export type PrivacyPolicyItemOutput = ReturnType<typeof toPrivacyPolicyItemOutput>;

/** Detalle: incluye la URL pública del PDF. */
export const toPrivacyPolicyDetailOutput = (policy: PrivacyPolicy) => ({
  id: policy.privacyPolicyId,
  version: policy.version,
  isActive: policy.isActive,
  summary: policy.summary || null,
  documentUrl: policy.documentUrl,
  effectiveDate: policy.effectiveDate,
  createdAt: policy.createdAt,
  updatedAt: policy.updatedAt
});
export type PrivacyPolicyDetailOutput = ReturnType<typeof toPrivacyPolicyDetailOutput>;

/** Respuesta al publicar: como el detalle, sin updatedAt. */
export const toPublishedPrivacyPolicyOutput = (policy: PrivacyPolicy) => ({
  id: policy.privacyPolicyId,
  version: policy.version,
  isActive: policy.isActive,
  summary: policy.summary || null,
  documentUrl: policy.documentUrl,
  effectiveDate: policy.effectiveDate,
  createdAt: policy.createdAt
});
export type PublishedPrivacyPolicyOutput = ReturnType<typeof toPublishedPrivacyPolicyOutput>;
