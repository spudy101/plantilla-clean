// Caso de uso: dejar constancia de que un usuario aceptó recibir comunicaciones comerciales (opcional en el
// registro). Si el tipo no está configurado devuelve null sin fallar.
import type { ConsentTypeRepository } from '../ports/consent-type-repository.port';
import type { UserConsentRepository } from '../ports/user-consent-repository.port';
import { CONSENT_TYPE_CODES } from '../../domain/consent-type';
import type { UserConsent } from '../../domain/user-consent';

export class GrantCommercialCommunicationsConsent {
  constructor(
    private readonly consentTypes: ConsentTypeRepository,
    private readonly userConsents: UserConsentRepository
  ) {}

  async execute({ userId, ip }: { userId: string; ip?: string | null }): Promise<UserConsent | null> {
    const type = await this.consentTypes.findActiveByCode(CONSENT_TYPE_CODES.COMUNICACIONES_COMERCIALES);
    if (!type) {
      return null;
    }
    return this.userConsents.grant({
      userId,
      consentTypeId: type.consentTypeId,
      privacyPolicyId: null,
      ip: ip || null,
      userAgent: null
    });
  }
}
