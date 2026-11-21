// API pública del módulo person: lo ÚNICO que otros módulos (y src/app.ts) pueden importar.
// Lo que no está acá es interno del módulo (docs/ARCHITECTURE.md, regla 2).
//
// Cada export se carga al usarse (getter): los módulos se usan entre sí y un index que cargara todo
// de una vez crearía ciclos de carga. Uso: import personModule from '…/person'; const { X } = personModule;
import { interopDefault } from '../../shared/kernel/interop.util';

export default {
  get personComponentsDto() {
    return interopDefault(
      require('./responses/person-components.response') as typeof import('./responses/person-components.response')
    );
  },

  /** Esquemas de salida (Zod) de person que otros módulos incluyen en sus respuestas. */
  get personSchemas() {
    const m = require('./responses/person-components.response') as typeof import('./responses/person-components.response');
    return {
      UserSchema: m.UserSchema,
      PersonSchema: m.PersonSchema,
      PersonContactSchema: m.PersonContactSchema,
      PersonLocationSchema: m.PersonLocationSchema
    };
  },

  get ProfileHelper() {
    return interopDefault(require('./helpers/profile.helper') as typeof import('./helpers/profile.helper'));
  },

  get personContactRepository() {
    return interopDefault(
      require('./repositories/person-contact.repository') as typeof import('./repositories/person-contact.repository')
    );
  },

  get personLocationRepository() {
    return interopDefault(
      require('./repositories/person-location.repository') as typeof import('./repositories/person-location.repository')
    );
  },

  get personReferenceRepository() {
    return interopDefault(
      require('./repositories/person-reference.repository') as typeof import('./repositories/person-reference.repository')
    );
  },

  get personRepository() {
    return interopDefault(require('./repositories/person.repository') as typeof import('./repositories/person.repository'));
  },

  get adminPersonRoutes() {
    return interopDefault(require('./routes/admin-person.routes') as typeof import('./routes/admin-person.routes'));
  },

  get personReferenceRoutes() {
    return interopDefault(require('./routes/person-reference.routes') as typeof import('./routes/person-reference.routes'));
  },

  get profileRoutes() {
    return interopDefault(require('./routes/profile.routes') as typeof import('./routes/profile.routes'));
  },

  get PersonService() {
    return interopDefault(require('./services/admin-person.service') as typeof import('./services/admin-person.service'));
  },

  get personGuards() {
    return interopDefault(
      require('./services/admin-person/person-guards') as typeof import('./services/admin-person/person-guards')
    );
  },

  get KycSharedUtil() {
    return interopDefault(require('./utils/kyc-shared.util') as typeof import('./utils/kyc-shared.util'));
  },

  /** Campos reutilizables para los esquemas de entrada (requests). */
  get personFields() {
    return interopDefault(require('./requests/person.fields') as typeof import('./requests/person.fields'));
  }
};
