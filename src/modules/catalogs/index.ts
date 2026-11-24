// API pública del módulo catalogs para los módulos que todavía no están en Clean Architecture
// (iam, notification) y para los adaptadores de src/main/ que conectan a person.
//
// En Clean, catalogs no se usa importando este index: src/main/container.ts arma el módulo
// (createCatalogsModule en catalogs.module.ts). Lo que queda acá es TRANSITORIO: búsquedas puntuales por id
// o código (devuelven entradas del dominio) y piezas de respuesta que otros módulos incluyen. Cuando esos
// módulos se migren, pedirán lo suyo con un puerto propio y esto se borra.
import type { PrismaGenderRepository } from './infrastructure/persistence/prisma-gender.repository';
import type { PrismaDocumentTypeRepository } from './infrastructure/persistence/prisma-document-type.repository';
import type { PrismaPhonePrefixRepository } from './infrastructure/persistence/prisma-phone-prefix.repository';
import type { PrismaAvatarRepository } from './infrastructure/persistence/prisma-avatar.repository';
import type { PrismaCountryRepository } from './infrastructure/persistence/prisma-country.repository';
import type { PrismaDepartmentRepository } from './infrastructure/persistence/prisma-department.repository';
import type { PrismaCityRepository } from './infrastructure/persistence/prisma-city.repository';

/** Una instancia de la clase exportada `name`; si el módulo está reemplazado por un jest.mock (objeto plano), el mock. */
function instanceOf<T>(mod: unknown, name: string): T {
  const Ctor = (mod as Record<string, unknown>)[name];
  return (typeof Ctor === 'function' ? new (Ctor as new () => T)() : mod) as T;
}

/** Una instancia por repositorio, creada al primer uso (los index se cargan perezosamente: ver ARCHITECTURE.md). */
const instances = new Map<string, unknown>();
function lazy<T>(key: string, create: () => T): T {
  if (!instances.has(key)) {
    instances.set(key, create());
  }
  return instances.get(key) as T;
}

export default {
  /** @deprecated Transitorio para iam y para el adaptador de person (src/main/adapters). */
  get documentTypeRepository(): PrismaDocumentTypeRepository {
    return lazy('documentType', () => {
      const m =
        require('./infrastructure/persistence/prisma-document-type.repository') as typeof import('./infrastructure/persistence/prisma-document-type.repository');
      return instanceOf(m, 'PrismaDocumentTypeRepository');
    });
  },

  /** @deprecated Transitorio para iam. */
  get countryRepository(): PrismaCountryRepository {
    return lazy('country', () => {
      const m =
        require('./infrastructure/persistence/prisma-country.repository') as typeof import('./infrastructure/persistence/prisma-country.repository');
      return instanceOf(m, 'PrismaCountryRepository');
    });
  },

  /** @deprecated Transitorio para iam y para el adaptador de person (src/main/adapters). */
  get genderRepository(): PrismaGenderRepository {
    return lazy('gender', () => {
      const m =
        require('./infrastructure/persistence/prisma-gender.repository') as typeof import('./infrastructure/persistence/prisma-gender.repository');
      return instanceOf(m, 'PrismaGenderRepository');
    });
  },

  /** @deprecated Transitorio para el adaptador de person (src/main/adapters). */
  get avatarRepository(): PrismaAvatarRepository {
    return lazy('avatar', () => {
      const m =
        require('./infrastructure/persistence/prisma-avatar.repository') as typeof import('./infrastructure/persistence/prisma-avatar.repository');
      return instanceOf(m, 'PrismaAvatarRepository');
    });
  },

  /** @deprecated Transitorio para el adaptador de person (src/main/adapters). */
  get departmentRepository(): PrismaDepartmentRepository {
    return lazy('department', () => {
      const m =
        require('./infrastructure/persistence/prisma-department.repository') as typeof import('./infrastructure/persistence/prisma-department.repository');
      return instanceOf(m, 'PrismaDepartmentRepository');
    });
  },

  /** @deprecated Transitorio para el adaptador de person (src/main/adapters). */
  get cityRepository(): PrismaCityRepository {
    return lazy('city', () => {
      const m =
        require('./infrastructure/persistence/prisma-city.repository') as typeof import('./infrastructure/persistence/prisma-city.repository');
      return instanceOf(m, 'PrismaCityRepository');
    });
  },

  /** @deprecated Transitorio para notification (SMS). */
  get phonePrefixRepository(): PrismaPhonePrefixRepository {
    return lazy('phonePrefix', () => {
      const m =
        require('./infrastructure/persistence/prisma-phone-prefix.repository') as typeof import('./infrastructure/persistence/prisma-phone-prefix.repository');
      return instanceOf(m, 'PrismaPhonePrefixRepository');
    });
  }
};
