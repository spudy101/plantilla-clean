// Composition root: el ÚNICO lugar de la aplicación donde se hacen los `new` y se conectan los módulos.
//
// Cada módulo en Clean Architecture expone una función create<Módulo>Module(deps). Acá se le pasan los
// adaptadores de los puertos que necesita (auditoría, notificaciones, logger, guardas HTTP) y se
// devuelve lo que la app monta (routers) o conecta a shared/ (fuentes de configuración).
//
// Los módulos que todavía no están migrados siguen cableándose solos (su index.ts); a medida que se migren
// se agregan acá y desaparecen sus singletons.
import loggerUtilModule from '../shared/infrastructure/observability/logger.util';
import { createSettingsModule } from '../modules/settings/settings.module';
import { auditTrailAdapter } from './adapters/audit-trail.adapter';
import { notifierAdapter } from './adapters/notifier.adapter';
import { routeGuardsAdapter } from './adapters/route-guards.adapter';

const { logger } = loggerUtilModule;

export function createContainer() {
  const settings = createSettingsModule({
    audit: auditTrailAdapter,
    notifier: notifierAdapter,
    logger,
    guards: routeGuardsAdapter
  });

  return { settings };
}

export type Container = ReturnType<typeof createContainer>;
