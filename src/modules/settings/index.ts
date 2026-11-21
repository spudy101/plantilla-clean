// API pública del módulo settings: lo ÚNICO que otros módulos (y src/app.ts) pueden importar.
// Lo que no está acá es interno del módulo (docs/ARCHITECTURE.md, regla 2).
//
// Cada export se carga al usarse (getter): los módulos se usan entre sí y un index que cargara todo
// de una vez crearía ciclos de carga. Uso: import settingsModule from '…/settings'; const { X } = settingsModule;
import { interopDefault } from '../../shared/utils/interop.util';

export default {
  get systemGlobalConfigRepository() {
    return interopDefault(require('./repositories/system-global-config.repository') as typeof import('./repositories/system-global-config.repository'));
  },

  get adminSystemGlobalConfigRoutes() {
    return interopDefault(require('./routes/system-global-config.routes') as typeof import('./routes/system-global-config.routes'));
  }
};
