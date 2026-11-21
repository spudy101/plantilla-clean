// Entidades a las que se atribuyen los eventos de auditoría de legal.
import type { PageQuery } from '../../../../shared/application/pagination';

export const CONSENT_TYPE_AUDIT_ENTITY = { entityType: 'ConsentType', entityTable: 'consent_types' } as const;
export const PRIVACY_POLICY_AUDIT_ENTITY = { entityType: 'PrivacyPolicy', entityTable: 'privacy_policies' } as const;
export const USER_CONSENT_AUDIT_ENTITY = { entityType: 'UserConsent', entityTable: 'user_consents' } as const;

/** Entrada de un listado: la página pedida (sortBy y order ya validados por la presentación) y la búsqueda. */
export type ListQuery = PageQuery & { search?: string | null };
