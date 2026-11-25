// Caso de uso: la política de privacidad vigente, para mostrarla al público.
//
// Cache-aside (12 h): se lee casi en cada registro y cambia muy pocas veces. La consulta se audita SIEMPRE,
// también cuando sale de la caché.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { KeyValueCache } from '../../../../shared/application/ports/key-value-cache.port';
import type { ActivePrivacyPolicyReader } from '../ports/catalog-reader.port';
import { ActivePrivacyPolicyNotFoundError } from '../../domain/errors';
import { toActivePrivacyPolicyOutput, type ActivePrivacyPolicyOutput } from '../dto/catalog.output';

export const PRIVACY_POLICY_CACHE_KEY = 'cache:privacy-policy:active';
/** La política vigente cambia poco y legal invalida la caché al publicar una versión nueva. */
const PRIVACY_POLICY_CACHE_HOURS = 12;
export const PRIVACY_POLICY_CACHE_TTL_SECONDS = PRIVACY_POLICY_CACHE_HOURS * 60 * 60;

export class GetActivePrivacyPolicy {
  constructor(
    private readonly policies: ActivePrivacyPolicyReader,
    private readonly cache: KeyValueCache,
    private readonly audit: AuditTrail
  ) {}

  async execute(): Promise<ActivePrivacyPolicyOutput> {
    const cached = (await this.cache.get(PRIVACY_POLICY_CACHE_KEY)) as ActivePrivacyPolicyOutput | null | undefined;
    if (cached) {
      await this.recordView(cached.version);
      return cached;
    }

    const policy = await this.policies.findActive();
    if (!policy) {
      throw new ActivePrivacyPolicyNotFoundError();
    }
    const output = toActivePrivacyPolicyOutput(policy);
    await this.recordView(policy.version);
    await this.cache.set(PRIVACY_POLICY_CACHE_KEY, output, PRIVACY_POLICY_CACHE_TTL_SECONDS);
    return output;
  }

  private recordView(version: string) {
    return this.audit.record('PRIVACY_POLICY_VIEWED', {
      actorId: null,
      details: { version },
      entityType: 'Catalog',
      entityTable: null
    });
  }
}
