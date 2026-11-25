// Los módulos ya armados, para los adaptadores que conectan unos con otros.
//
// Los módulos se necesitan entre sí (iam audita con audit y audit muestra las sesiones de iam; iam crea personas en
// person y person cambia cuentas de iam…), así que no hay un orden de creación que deje a todos con lo suyo listo.
// Los adaptadores reciben `modules` y lo leen AL USARSE (en cada llamada, nunca al armarse): cuando llega el primer
// request, src/main/container.ts ya los creó a todos.
import type { ApprovalsModule } from '../../modules/approvals/approvals.module';
import type { AuditModule } from '../../modules/audit/audit.module';
import type { CatalogsModule } from '../../modules/catalogs/catalogs.module';
import type { IamModule } from '../../modules/iam/iam.module';
import type { LegalModule } from '../../modules/legal/legal.module';
import type { NotificationModule } from '../../modules/notification/notification.module';
import type { PersonModule } from '../../modules/person/person.module';
import type { SettingsModule } from '../../modules/settings/settings.module';

export interface Modules {
  iam: IamModule;
  audit: AuditModule;
  notification: NotificationModule;
  settings: SettingsModule;
  catalogs: CatalogsModule;
  legal: LegalModule;
  approvals: ApprovalsModule;
  person: PersonModule;
}

export type ModuleRegistry = {
  readonly [K in keyof Modules]: Modules[K];
};

/** Un registro que se completa a medida que el container crea cada módulo; leer uno que falta es un error. */
export function createModuleRegistry(): { modules: ModuleRegistry; register<K extends keyof Modules>(name: K, module: Modules[K]): Modules[K] } {
  const created: Partial<Modules> = {};
  const modules = new Proxy(created, {
    get(target, name: string) {
      const module = target[name as keyof Modules];
      if (!module) {
        throw new Error(`El módulo ${name} todavía no está armado (src/main/container.ts)`);
      }
      return module;
    }
  }) as ModuleRegistry;
  return {
    modules,
    register(name, module) {
      created[name] = module;
      return module;
    }
  };
}
