// Lo que devuelven los casos de uso sobre consentimientos otorgados. Los campos y su orden son los de la API
// de siempre.
import type { ConsentType } from '../../domain/consent-type';
import { holderFullName, type PrivacyPolicyRef, type UserConsent } from '../../domain/user-consent';
import { toConsentTypeOutput } from './consent-type.output';

export const toPrivacyPolicyRefOutput = (policy: PrivacyPolicyRef | null | undefined) =>
  policy
    ? {
        privacyPolicyId: policy.privacyPolicyId,
        version: policy.version,
        documentUrl: policy.documentUrl,
        effectiveDate: policy.effectiveDate
      }
    : null;

/** Vista admin: con el titular y la sesión en que se otorgó. */
export const toUserConsentOutput = (consent: UserConsent) => ({
  userConsentId: consent.userConsentId,
  userId: consent.userId,
  user: consent.holder
    ? { userId: consent.holder.userId, username: consent.holder.username, fullName: holderFullName(consent.holder) }
    : null,
  consentType: consent.consentType ? toConsentTypeOutput(consent.consentType) : null,
  privacyPolicy: toPrivacyPolicyRefOutput(consent.privacyPolicy),
  grantedAt: consent.grantedAt,
  grantedIp: consent.grantedIp,
  originSessionId: consent.originSessionId ?? null,
  revokedAt: consent.revokedAt ?? null,
  revocationReason: consent.revocationReason ?? null,
  isCurrent: consent.isCurrent,
  createdAt: consent.createdAt
});
export type UserConsentOutput = ReturnType<typeof toUserConsentOutput>;

/** Lo que recibe el usuario por cada consentimiento que acaba de otorgar. */
export const toGrantedConsentOutput = (consent: UserConsent) => ({
  userConsentId: consent.userConsentId,
  consentTypeId: consent.consentTypeId,
  grantedAt: consent.grantedAt,
  isCurrent: consent.isCurrent
});
export type GrantedConsentOutput = ReturnType<typeof toGrantedConsentOutput>;

/**
 * Item del catálogo del usuario: un tipo activo y su estado para ese usuario. Sin otorgamiento vigente
 * (consent null): granted=false y los campos del otorgamiento en null.
 */
export const toMyConsentCatalogItemOutput = (type: ConsentType, consent: UserConsent | null) => ({
  consentType: toConsentTypeOutput(type),
  granted: Boolean(consent),
  userConsentId: consent ? consent.userConsentId : null,
  privacyPolicy: consent ? toPrivacyPolicyRefOutput(consent.privacyPolicy) : null,
  grantedAt: consent ? consent.grantedAt : null,
  revokedAt: consent ? (consent.revokedAt ?? null) : null,
  isCurrent: consent ? consent.isCurrent : false
});
export type MyConsentCatalogItemOutput = ReturnType<typeof toMyConsentCatalogItemOutput>;

/** El catálogo completo: cada tipo activo con el consentimiento vigente del usuario, si lo tiene. */
export function toMyConsentCatalogOutput(types: readonly ConsentType[], current: readonly UserConsent[]) {
  const byType = new Map(current.map(c => [c.consentTypeId, c]));
  return types.map(type => toMyConsentCatalogItemOutput(type, byType.get(type.consentTypeId) ?? null));
}
