// API pública del módulo legal: lo ÚNICO que otros módulos (y src/app.ts) pueden importar.
// Lo que no está acá es interno del módulo (docs/ARCHITECTURE.md, regla 2).
//
// Cada export se carga al usarse (getter): los módulos se usan entre sí y un index que cargara todo
// de una vez crearía ciclos de carga. Uso: import legalModule from '…/legal'; const { X } = legalModule;
import { interopDefault } from '../../shared/kernel/interop.util';

export default {
  get consentTypeRepository() {
    return interopDefault(
      require('./repositories/consent-type.repository') as typeof import('./repositories/consent-type.repository')
    );
  },

  get privacyPolicyAdminRepository() {
    return interopDefault(
      require('./repositories/privacy-policy-admin.repository') as typeof import('./repositories/privacy-policy-admin.repository')
    );
  },

  get privacyPolicyRepository() {
    return interopDefault(
      require('./repositories/privacy-policy.repository') as typeof import('./repositories/privacy-policy.repository')
    );
  },

  get userConsentRepository() {
    return interopDefault(
      require('./repositories/user-consent.repository') as typeof import('./repositories/user-consent.repository')
    );
  },

  get adminUserConsentRoutes() {
    return interopDefault(require('./routes/admin-user-consent.routes') as typeof import('./routes/admin-user-consent.routes'));
  },

  get adminConsentTypeRoutes() {
    return interopDefault(require('./routes/consent-type.routes') as typeof import('./routes/consent-type.routes'));
  },

  get privacyPolicyAdminRoutes() {
    return interopDefault(
      require('./routes/privacy-policy-admin.routes') as typeof import('./routes/privacy-policy-admin.routes')
    );
  },

  get userConsentRoutes() {
    return interopDefault(require('./routes/user-consent.routes') as typeof import('./routes/user-consent.routes'));
  },

  get consentRecorder() {
    return interopDefault(require('./services/consent-recorder.service') as typeof import('./services/consent-recorder.service'));
  },

  /** Componentes de salida (consentimientos, tipos, política) que usan otros módulos. */
  get legalComponentsDto() {
    return interopDefault(
      require('./responses/legal-components.response') as typeof import('./responses/legal-components.response')
    );
  },

  /** Esquemas de salida (Zod) de legal que otros módulos incluyen en sus respuestas. */
  get legalSchemas() {
    const m = require('./responses/legal-components.response') as typeof import('./responses/legal-components.response');
    return { MyConsentCatalogItemSchema: m.MyConsentCatalogItemSchema };
  }
};
