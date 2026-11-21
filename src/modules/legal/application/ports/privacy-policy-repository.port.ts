// Puerto de persistencia de las versiones de la política de privacidad. Lo implementa
// infrastructure/persistence/prisma-privacy-policy.repository.ts.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { NewPrivacyPolicyVersion, PrivacyPolicy } from '../../domain/privacy-policy';

export interface PrivacyPolicyFilters {
  isActive?: boolean;
}

export interface PrivacyPolicyPage {
  rows: PrivacyPolicy[];
  count: number;
}

export interface PrivacyPolicyRepository {
  /** La versión vigente; null si no hay (es un error de configuración, lo decide quien llama). */
  findActive(): Promise<PrivacyPolicy | null>;

  findById(privacyPolicyId: string): Promise<PrivacyPolicy | null>;

  versionExists(version: string): Promise<boolean>;

  /** Listado paginado, con búsqueda por versión o resumen. */
  list(filters: PrivacyPolicyFilters, page: PageRequest, search: string | null): Promise<PrivacyPolicyPage>;

  /** Publica la versión como la ÚNICA vigente (la anterior deja de estarlo), de forma atómica. */
  publish(version: NewPrivacyPolicyVersion): Promise<PrivacyPolicy>;
}
