// API pública del módulo legal para los módulos que todavía no están en Clean Architecture (iam, person,
// y la traza de sesión de audit, que lo lee desde src/main/adapters/audit-sources.adapter.ts).
//
// En Clean, legal no se usa importando este index: src/main/container.ts arma el módulo (createLegalModule en
// legal.module.ts). Lo que queda acá es TRANSITORIO: lecturas puntuales (devuelven entidades del dominio), el
// registro de consentimientos del registro y el login, y las piezas de respuesta que otros módulos incluyen.
// Cuando esos módulos se migren, pedirán lo suyo con un puerto propio y esto se borra.
import type { PrismaConsentTypeRepository } from './infrastructure/persistence/prisma-consent-type.repository';
import type { PrismaPrivacyPolicyRepository } from './infrastructure/persistence/prisma-privacy-policy.repository';
import type { PrismaUserConsentRepository } from './infrastructure/persistence/prisma-user-consent.repository';
import type { GrantPrivacyPolicyConsentInput } from './application/use-cases/grant-privacy-policy-consent.use-case';
import type { UserConsent } from './domain/user-consent';

/** Una instancia de la clase exportada `name`; si el módulo está reemplazado por un jest.mock (objeto plano), el mock. */
function instanceOf<T>(mod: unknown, name: string): T {
  const Ctor = (mod as Record<string, unknown>)[name];
  return (typeof Ctor === 'function' ? new (Ctor as new () => T)() : mod) as T;
}

/** Una instancia por pieza, creada al primer uso (los index se cargan perezosamente: ver ARCHITECTURE.md). */
const instances = new Map<string, unknown>();
function lazy<T>(key: string, create: () => T): T {
  if (!instances.has(key)) {
    instances.set(key, create());
  }
  return instances.get(key) as T;
}

const repositories = {
  consentTypes: () =>
    lazy('consentTypes', () =>
      instanceOf<PrismaConsentTypeRepository>(
        require('./infrastructure/persistence/prisma-consent-type.repository'),
        'PrismaConsentTypeRepository'
      )
    ),
  privacyPolicies: () =>
    lazy('privacyPolicies', () =>
      instanceOf<PrismaPrivacyPolicyRepository>(
        require('./infrastructure/persistence/prisma-privacy-policy.repository'),
        'PrismaPrivacyPolicyRepository'
      )
    ),
  userConsents: () =>
    lazy('userConsents', () =>
      instanceOf<PrismaUserConsentRepository>(
        require('./infrastructure/persistence/prisma-user-consent.repository'),
        'PrismaUserConsentRepository'
      )
    )
};

/** Registro de consentimientos que usan registro, login y biometría (iam). */
export interface ConsentRecorder {
  grantPrivacyPolicy(input: GrantPrivacyPolicyConsentInput): Promise<UserConsent | null>;
  grantCommercialCommunications(input: { userId: string; ip?: string | null }): Promise<UserConsent | null>;
}

export default {
  /** @deprecated Transitorio para iam (política vigente al registrar / iniciar sesión). */
  get privacyPolicyRepository(): Pick<PrismaPrivacyPolicyRepository, 'findActive'> {
    return repositories.privacyPolicies();
  },

  /** @deprecated Transitorio para person (catálogo de consentimientos del perfil). */
  get consentTypeRepository(): Pick<PrismaConsentTypeRepository, 'listActive'> {
    return repositories.consentTypes();
  },

  /** @deprecated Transitorio para person (perfil y derecho de supresión) y la traza de sesión de audit (src/main/adapters). */
  get userConsentRepository(): Pick<PrismaUserConsentRepository, 'findCurrentByUser' | 'findByIds' | 'revokeAll'> {
    return repositories.userConsents();
  },

  /** @deprecated Transitorio para iam: los casos de uso GrantPrivacyPolicyConsent y GrantCommercialCommunicationsConsent. */
  get consentRecorder(): ConsentRecorder {
    return lazy('consentRecorder', () => {
      const { GrantPrivacyPolicyConsent } =
        require('./application/use-cases/grant-privacy-policy-consent.use-case') as typeof import('./application/use-cases/grant-privacy-policy-consent.use-case');
      const { GrantCommercialCommunicationsConsent } =
        require('./application/use-cases/grant-commercial-communications-consent.use-case') as typeof import('./application/use-cases/grant-commercial-communications-consent.use-case');
      const privacy = new GrantPrivacyPolicyConsent(repositories.consentTypes(), repositories.userConsents(), repositories.privacyPolicies());
      const commercial = new GrantCommercialCommunicationsConsent(repositories.consentTypes(), repositories.userConsents());
      return {
        grantPrivacyPolicy: input => privacy.execute(input),
        grantCommercialCommunications: input => commercial.execute(input)
      };
    });
  },

  /** @deprecated Transitorio para person (perfil) y la traza de sesión de audit (src/main/adapters): salidas de consentimientos. */
  get legalComponentsDto() {
    const m = require('./application/dto/user-consent.output') as typeof import('./application/dto/user-consent.output');
    return {
      UserConsentComponent: { build: m.toUserConsentOutput, buildClientCatalogItem: m.toMyConsentCatalogItemOutput }
    };
  },

  /** Esquemas de salida (Zod) de legal que otros módulos incluyen en sus respuestas. */
  get legalSchemas() {
    const m = require('./presentation/http/responses/legal.response') as typeof import('./presentation/http/responses/legal.response');
    return { MyConsentCatalogItemSchema: m.MyConsentCatalogItemSchema };
  }
};
