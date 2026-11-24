// API pública del módulo person para los módulos que todavía no están en Clean Architecture (iam).
//
// En Clean, person no se usa importando este index: src/main/container.ts arma el módulo (createPersonModule en
// person.module.ts) y la doble aprobación recibe su baja de cuentas desde ahí. Lo que queda acá es TRANSITORIO:
// los repositorios con los que iam crea personas y contactos al registrar usuarios, la unicidad de documento y
// email, la baja de cuentas internas, la bitácora y las piezas de salida y de entrada que iam incluye en sus
// respuestas y requests. Cuando iam se migre, pedirá lo suyo con un puerto propio y esto se borra.
//
// Cada pieza se carga al usarse (getter): los módulos se usan entre sí y un index que cargara todo de una vez
// crearía ciclos de carga.
import { interopDefault } from '../../shared/kernel/interop.util';
import type { PrismaPersonRepository } from './infrastructure/persistence/prisma-person.repository';
import type { PrismaPersonContactRepository } from './infrastructure/persistence/prisma-person-contact.repository';

/** Una instancia de la clase exportada `name`; si el módulo está reemplazado por un jest.mock (objeto plano), el mock. */
function instanceOf<T>(mod: unknown, name: string): T {
  const Ctor = (mod as Record<string, unknown>)[name];
  return (typeof Ctor === 'function' ? new (Ctor as new () => T)() : mod) as T;
}

/** Una instancia por pieza, creada al primer uso. */
const instances = new Map<string, unknown>();
function lazy<T>(key: string, create: () => T): T {
  if (!instances.has(key)) {
    instances.set(key, create());
  }
  return instances.get(key) as T;
}

export default {
  /** @deprecated Transitorio para iam (registro y alta de usuarios internos). */
  get personRepository(): Pick<PrismaPersonRepository, 'create' | 'update' | 'findByNationalId'> {
    return lazy('persons', () =>
      instanceOf<PrismaPersonRepository>(require('./infrastructure/persistence/prisma-person.repository'), 'PrismaPersonRepository')
    );
  },

  /** @deprecated Transitorio para iam (registro, alta de usuarios internos y reset de credenciales). */
  get personContactRepository(): Pick<PrismaPersonContactRepository, 'create' | 'findByEmail' | 'findByEmailWithUser'> {
    return lazy('contacts', () =>
      instanceOf<PrismaPersonContactRepository>(
        require('./infrastructure/persistence/prisma-person-contact.repository'),
        'PrismaPersonContactRepository'
      )
    );
  },

  /** @deprecated Transitorio para iam: unicidad de documento y email, y la baja de un usuario interno. */
  get ProfileHelper() {
    return interopDefault(require('./infrastructure/legacy/profile-helper') as typeof import('./infrastructure/legacy/profile-helper'));
  },

  /** @deprecated Transitorio para iam: contraseñas temporales y la bitácora de cambios de la cuenta. */
  get KycSharedUtil() {
    return interopDefault(require('./infrastructure/legacy/kyc-shared.util') as typeof import('./infrastructure/legacy/kyc-shared.util'));
  },

  /** @deprecated Transitorio para iam: la persona de una cuenta (error explícito si la lectura no la trajo). */
  get personGuards() {
    const { requirePerson } = require('./domain/client-account') as typeof import('./domain/client-account');
    return { requirePerson };
  },

  /** @deprecated Transitorio para iam (login, registro, usuarios internos): piezas de salida de person. */
  get personComponentsDto() {
    const m = require('./application/dto/person.output') as typeof import('./application/dto/person.output');
    return {
      UserComponent: { build: m.toUserOutput },
      PersonComponent: { build: m.toPersonOutput },
      PersonContactComponent: { build: m.toContactOutput },
      PersonLocationComponent: { build: m.toLocationOutput }
    };
  },

  /** Esquemas de salida (Zod) de person que otros módulos incluyen en sus respuestas. */
  get personSchemas() {
    const m = require('./presentation/http/responses/person-components.response') as typeof import('./presentation/http/responses/person-components.response');
    return {
      UserSchema: m.UserSchema,
      PersonSchema: m.PersonSchema,
      PersonContactSchema: m.PersonContactSchema,
      PersonLocationSchema: m.PersonLocationSchema
    };
  },

  /** Campos reutilizables para los esquemas de entrada (requests). */
  get personFields() {
    return interopDefault(require('./presentation/http/requests/person.fields') as typeof import('./presentation/http/requests/person.fields'));
  }
};
