// Casos de uso que usan otros módulos (por los adaptadores de src/main/) sobre la política y los consentimientos:
//
//   FindActivePrivacyPolicy   la versión vigente (el registro y el login de iam, el catálogo público de catalogs)
//   GetConsentCatalog         cada tipo activo con el estado del titular (el perfil de person)
//   RevokeAllConsents         el derecho de supresión (la baja de una cuenta en person)
//   FindConsentsByIds         los consentimientos que muestra la traza de una sesión (audit)
//
// No se auditan: los pide otro módulo como parte de una operación que ya audita la suya.
import type { ConsentTypeRepository } from '../ports/consent-type-repository.port';
import type { PrivacyPolicyRepository } from '../ports/privacy-policy-repository.port';
import type { UserConsentRepository } from '../ports/user-consent-repository.port';
import { toMyConsentCatalogOutput, toUserConsentOutput } from '../dto/user-consent.output';

export class FindActivePrivacyPolicy {
  constructor(private readonly policies: Pick<PrivacyPolicyRepository, 'findActive'>) {}

  execute() {
    return this.policies.findActive();
  }
}

export class GetConsentCatalog {
  constructor(
    private readonly consentTypes: Pick<ConsentTypeRepository, 'listActive'>,
    private readonly userConsents: Pick<UserConsentRepository, 'findCurrentByUser'>
  ) {}

  async execute(userId: string) {
    const [types, consents] = await Promise.all([this.consentTypes.listActive(), this.userConsents.findCurrentByUser(userId)]);
    return toMyConsentCatalogOutput(types, consents);
  }
}

export class RevokeAllConsents {
  constructor(private readonly userConsents: Pick<UserConsentRepository, 'revokeAll'>) {}

  async execute(userId: string): Promise<void> {
    await this.userConsents.revokeAll(userId);
  }
}

export class FindConsentsByIds {
  constructor(private readonly userConsents: Pick<UserConsentRepository, 'findByIds'>) {}

  async execute(ids: readonly string[]) {
    return (await this.userConsents.findByIds(ids)).map(toUserConsentOutput);
  }
}
