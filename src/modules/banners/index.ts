// API pública del módulo banners: lo ÚNICO que otros módulos (y src/app.ts) pueden importar.
// Lo que no está acá es interno del módulo (docs/ARCHITECTURE.md, regla 2).
//
// Cada export se carga al usarse (getter): los módulos se usan entre sí y un index que cargara todo
// de una vez crearía ciclos de carga. Uso: import bannersModule from '…/banners'; const { X } = bannersModule;
import { interopDefault } from '../../shared/kernel/interop.util';

export default {
  get adminPromotionalBannerRoutes() {
    return interopDefault(require('./routes/admin-promotional-banner.routes') as typeof import('./routes/admin-promotional-banner.routes'));
  },

  get promotionalBannerRoutes() {
    return interopDefault(require('./routes/promotional-banner.routes') as typeof import('./routes/promotional-banner.routes'));
  }
};
