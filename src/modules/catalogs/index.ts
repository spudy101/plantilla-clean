// API pública del módulo catalogs: lo ÚNICO que otros módulos (y src/app.ts) pueden importar.
// Lo que no está acá es interno del módulo (docs/ARCHITECTURE.md, regla 2).
//
// Cada export se carga al usarse (getter): los módulos se usan entre sí y un index que cargara todo
// de una vez crearía ciclos de carga. Uso: import catalogsModule from '…/catalogs'; const { X } = catalogsModule;
import { interopDefault } from '../../shared/utils/interop.util';

export default {
  get catalogComponentsDto() {
    return interopDefault(
      require('./responses/catalog-components.response') as typeof import('./responses/catalog-components.response')
    );
  },

  /** Esquemas de salida (Zod) de los catálogos que otros módulos incluyen en sus respuestas. */
  get catalogSchemas() {
    const m = require('./responses/catalog-components.response') as typeof import('./responses/catalog-components.response');
    return { RoleSchema: m.RoleSchema };
  },

  get avatarThemeRepository() {
    return interopDefault(
      require('./repositories/avatar-theme.repository') as typeof import('./repositories/avatar-theme.repository')
    );
  },

  get avatarRepository() {
    return interopDefault(require('./repositories/avatar.repository') as typeof import('./repositories/avatar.repository'));
  },

  get cityRepository() {
    return interopDefault(require('./repositories/city.repository') as typeof import('./repositories/city.repository'));
  },

  get countryRepository() {
    return interopDefault(require('./repositories/country.repository') as typeof import('./repositories/country.repository'));
  },

  get departmentRepository() {
    return interopDefault(
      require('./repositories/department.repository') as typeof import('./repositories/department.repository')
    );
  },

  get documentTypeRepository() {
    return interopDefault(
      require('./repositories/document-type.repository') as typeof import('./repositories/document-type.repository')
    );
  },

  get genderRepository() {
    return interopDefault(require('./repositories/gender.repository') as typeof import('./repositories/gender.repository'));
  },

  get phonePrefixRepository() {
    return interopDefault(
      require('./repositories/phone-prefix.repository') as typeof import('./repositories/phone-prefix.repository')
    );
  },

  get maintainersRoutes() {
    return interopDefault(require('./routes/maintainers.routes') as typeof import('./routes/maintainers.routes'));
  }
};
