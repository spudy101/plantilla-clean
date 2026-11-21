// Esquemas de salida (Zod) del módulo legal: documentan en Swagger lo que devuelven los casos de uso
// (application/dto) y un test verifica que esa salida los cumple.
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';

// ── Tipos de consentimiento ───────────────────────────────────
export const ConsentTypeSchema = z.object({
  consentTypeId: z.uuid(),
  code: z.string().meta({ example: 'PRIVACY_POLICY' }),
  name: z.string().nullish(),
  isMandatory: z.boolean().nullish(),
  isRevocable: z.boolean().nullish(),
  isActive: z.boolean().nullish(),
  scope: z.string().nullish()
});
export const ConsentTypeListItemSchema = ConsentTypeSchema.extend({ createdAt: dateTime().nullish() });
export const ConsentTypeDetailSchema = ConsentTypeSchema.extend({
  description: z.string().nullable(),
  createdAt: dateTime().nullish(),
  updatedAt: dateTime().nullish()
});

// ── Consentimientos otorgados ─────────────────────────────────
export const PrivacyPolicyRefSchema = z.object({
  privacyPolicyId: z.uuid(),
  version: z.string().meta({ example: '1.0' }),
  documentUrl: z.string().nullish(),
  effectiveDate: dateTime().nullish()
});

const UserRefSchema = z.object({ userId: z.uuid(), username: z.string().nullish(), fullName: z.string().nullable() });

export const UserConsentSchema = z
  .object({
    userConsentId: z.uuid(),
    userId: z.string().nullish(),
    user: UserRefSchema.nullable(),
    consentType: ConsentTypeSchema.nullable(),
    privacyPolicy: PrivacyPolicyRefSchema.nullable(),
    grantedAt: dateTime().nullish(),
    grantedIp: z.string().nullish(),
    originSessionId: z.string().nullable().meta({ description: 'Sesión en que se otorgó (trazabilidad).' }),
    revokedAt: dateTime().nullable(),
    revocationReason: z.string().nullable(),
    isCurrent: z.boolean().nullish(),
    createdAt: dateTime().nullish()
  })
  .meta({ description: 'Consentimiento de un usuario (vista admin).' });

export const ConsentGrantedSchema = z.object({
  userConsentId: z.uuid(),
  consentTypeId: z.string().nullish(),
  grantedAt: dateTime().nullish(),
  isCurrent: z.boolean().nullish()
});

export const MyConsentCatalogItemSchema = z
  .object({
    consentType: ConsentTypeSchema.nullable(),
    granted: z.boolean(),
    userConsentId: z.string().nullable(),
    privacyPolicy: PrivacyPolicyRefSchema.nullable(),
    grantedAt: dateTime().nullish(),
    revokedAt: dateTime().nullable(),
    isCurrent: z.boolean().nullish()
  })
  .meta({ description: 'Un tipo de consentimiento activo y si el usuario lo tiene otorgado.' });

// ── Políticas de privacidad (admin) ───────────────────────────
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
