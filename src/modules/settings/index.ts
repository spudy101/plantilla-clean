// API pública del módulo settings para los módulos que todavía no están en Clean Architecture.
//
// En Clean, settings no se usa importando este index: src/main/container.ts arma el módulo
// (createSettingsModule en settings.module.ts) y reparte sus casos de uso a quien los necesite.
// Lo que queda acá es TRANSITORIO y se borra al migrar approvals
// (ver infrastructure/persistence/legacy-system-global-config.repository.ts).
import { interopDefault } from '../../shared/kernel/interop.util';

export default {
  /** @deprecated Acceso crudo a la fila de system_global_config para módulos sin migrar. */
  get systemGlobalConfigRepository() {
    return interopDefault(
      require('./infrastructure/persistence/legacy-system-global-config.repository') as typeof import('./infrastructure/persistence/legacy-system-global-config.repository')
    );
  }
};
