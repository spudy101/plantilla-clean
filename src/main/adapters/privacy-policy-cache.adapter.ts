// Adaptador: la caché de la política vigente que lee catalogs (GetActivePrivacyPolicy), vista como el puerto
// ActivePrivacyPolicyCache de legal. Vive acá porque conecta dos módulos: legal invalida, catalogs lee, y
// ninguno conoce al otro.
import type { ActivePrivacyPolicyCache } from '../../modules/legal/application/ports/active-privacy-policy-cache.port';
import type { KeyValueCache } from '../../shared/application/ports/key-value-cache.port';
import { PRIVACY_POLICY_CACHE_KEY } from '../../modules/catalogs/application/use-cases/get-active-privacy-policy.use-case';

export function privacyPolicyCacheAdapter(cache: KeyValueCache): ActivePrivacyPolicyCache {
  return {
    async invalidate() {
      await cache.del(PRIVACY_POLICY_CACHE_KEY);
    }
  };
}
