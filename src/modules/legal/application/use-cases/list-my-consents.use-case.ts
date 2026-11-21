// Caso de uso: el usuario ve el catálogo de consentimientos (cada tipo activo) con su estado en cada uno.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { ConsentTypeRepository } from '../ports/consent-type-repository.port';
import type { UserConsentRepository } from '../ports/user-consent-repository.port';
import { toMyConsentCatalogOutput, type MyConsentCatalogItemOutput } from '../dto/user-consent.output';

export class ListMyConsents {
  constructor(
    private readonly consentTypes: ConsentTypeRepository,
    private readonly userConsents: UserConsentRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ userId }: { userId: string }): Promise<MyConsentCatalogItemOutput[]> {
    const [types, current] = await Promise.all([this.consentTypes.listActive(), this.userConsents.findCurrentByUser(userId)]);
    const catalog = toMyConsentCatalogOutput(types, current);

    await this.audit.record('CONSENT_CATALOG_VIEWED', {
      actorId: userId,
      details: { totalItems: catalog.length, grantedCount: current.length },
      entityTable: 'consent_types'
    });

    return catalog;
  }
}
