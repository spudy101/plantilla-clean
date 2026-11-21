// Caso de uso: dejar constancia de que un usuario aceptó la política de privacidad (registro, login,
// biometría). Lo llaman otros módulos; ellos deciden si es best-effort y qué loguear.
//
// Si el tipo PRIVACY_POLICY no está configurado no hay dónde registrarlo: devuelve null sin fallar.
import type { ConsentTypeRepository } from '../ports/consent-type-repository.port';
import type { PrivacyPolicyRepository } from '../ports/privacy-policy-repository.port';
import type { UserConsentRepository } from '../ports/user-consent-repository.port';
import { CONSENT_TYPE_CODES } from '../../domain/consent-type';
import type { UserConsent } from '../../domain/user-consent';

export interface GrantPrivacyPolicyConsentInput {
  userId: string;
  /** La versión aceptada. undefined → la vigente; null → sin versión asociada. */
  privacyPolicyId?: string | null;
  ip?: string | null;
}

export class GrantPrivacyPolicyConsent {
  constructor(
    private readonly consentTypes: ConsentTypeRepository,
    private readonly userConsents: UserConsentRepository,
    private readonly policies: PrivacyPolicyRepository
  ) {}

  async execute({ userId, privacyPolicyId, ip }: GrantPrivacyPolicyConsentInput): Promise<UserConsent | null> {
    const type = await this.consentTypes.findActiveByCode(CONSENT_TYPE_CODES.PRIVACY_POLICY);
    if (!type) {
      return null;
    }
    let policyId = privacyPolicyId;
    if (policyId === undefined) {
      policyId = (await this.policies.findActive())?.privacyPolicyId || null;
    }
    return this.userConsents.grant({
      userId,
      consentTypeId: type.consentTypeId,
      privacyPolicyId: policyId,
      ip: ip || null,
      userAgent: null
    });
  }
}
