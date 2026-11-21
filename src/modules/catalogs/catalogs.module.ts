// Composición del módulo catalogs: el ÚNICO archivo del módulo que conoce todas sus capas.
//
// Los catálogos propios (países, ciudades, géneros…) los lee con sus repositorios Prisma. Los que son de
// otros módulos (roles de iam, tipos de notificación de notification, política de privacidad de legal)
// llegan como puertos desde src/main/container.ts: catalogs no importa ningún otro módulo.
import type { Router } from 'express';
import type { AuditTrail } from '../../shared/application/ports/audit-trail.port';
import type { KeyValueCache } from '../../shared/application/ports/key-value-cache.port';
import type { ActivePrivacyPolicyReader, CatalogReader } from './application/ports/catalog-reader.port';
import type { NotificationTypeEntry, RoleEntry } from './domain/catalog-entries';
import * as output from './application/dto/catalog.output';
import { ListCatalog } from './application/use-cases/list-catalog.use-case';
import { ListClientDocumentTypes } from './application/use-cases/list-client-document-types.use-case';
import { GetActivePrivacyPolicy } from './application/use-cases/get-active-privacy-policy.use-case';
import { PrismaGenderRepository } from './infrastructure/persistence/prisma-gender.repository';
import { PrismaDocumentTypeRepository } from './infrastructure/persistence/prisma-document-type.repository';
import { PrismaPhonePrefixRepository } from './infrastructure/persistence/prisma-phone-prefix.repository';
import { PrismaAvatarRepository } from './infrastructure/persistence/prisma-avatar.repository';
import { PrismaAvatarThemeRepository } from './infrastructure/persistence/prisma-avatar-theme.repository';
import { PrismaCountryRepository } from './infrastructure/persistence/prisma-country.repository';
import { PrismaDepartmentRepository } from './infrastructure/persistence/prisma-department.repository';
import { PrismaCityRepository } from './infrastructure/persistence/prisma-city.repository';
import { CatalogsController } from './presentation/http/catalogs.controller';
import { createCatalogsRouter } from './presentation/http/catalogs.routes';

export interface CatalogsModuleDeps {
  audit: AuditTrail;
  cache: KeyValueCache;
  /** Catálogos de otros módulos, de solo lectura. */
  roles: CatalogReader<RoleEntry>;
  notificationTypes: CatalogReader<NotificationTypeEntry>;
  privacyPolicies: ActivePrivacyPolicyReader;
}

export function createCatalogsModule({ audit, cache, roles, notificationTypes, privacyPolicies }: CatalogsModuleDeps) {
  const documentTypes = new PrismaDocumentTypeRepository();

  const useCases = {
    listGenders: new ListCatalog(new PrismaGenderRepository(), audit, 'MAINTAINER_GENDERS_VIEWED', output.toGenderOutput),
    listPhonePrefixes: new ListCatalog(
      new PrismaPhonePrefixRepository(),
      audit,
      'MAINTAINER_PHONE_PREFIXES_VIEWED',
      output.toPhonePrefixOutput
    ),
    listAvatars: new ListCatalog(new PrismaAvatarRepository(), audit, 'MAINTAINER_AVATARS_VIEWED', output.toAvatarOutput),
    listAvatarThemes: new ListCatalog(
      new PrismaAvatarThemeRepository(),
      audit,
      'MAINTAINER_AVATAR_THEMES_VIEWED',
      output.toAvatarThemeOutput
    ),
    listCountries: new ListCatalog(new PrismaCountryRepository(), audit, 'MAINTAINER_COUNTRIES_VIEWED', output.toCountryOutput),
    listDepartments: new ListCatalog(
      new PrismaDepartmentRepository(),
      audit,
      'MAINTAINER_DEPARTMENTS_VIEWED',
      output.toDepartmentOutput
    ),
    listCities: new ListCatalog(new PrismaCityRepository(), audit, 'MAINTAINER_CITIES_VIEWED', output.toCityOutput),
    listRoles: new ListCatalog(roles, audit, 'MAINTAINER_ROLES_VIEWED', output.toRoleOutput),
    listNotificationTypes: new ListCatalog(
      notificationTypes,
      audit,
      'MAINTAINER_NOTIFICATION_TYPES_VIEWED',
      output.toNotificationTypeOutput
    ),
    listClientDocumentTypes: new ListClientDocumentTypes(documentTypes, audit),
    getActivePrivacyPolicy: new GetActivePrivacyPolicy(privacyPolicies, cache, audit)
  };

  const controller = new CatalogsController(useCases);
  const router: Router = createCatalogsRouter(controller);

  return { router, useCases };
}

export type CatalogsModule = ReturnType<typeof createCatalogsModule>;
