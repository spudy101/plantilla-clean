import genderRepository from '../repositories/gender.repository';
import documentTypeRepository from '../repositories/document-type.repository';
import phonePrefixRepository from '../repositories/phone-prefix.repository';
import avatarRepository from '../repositories/avatar.repository';
import avatarThemeRepository from '../repositories/avatar-theme.repository';
import countryRepository from '../repositories/country.repository';
import departmentRepository from '../repositories/department.repository';
import cityRepository from '../repositories/city.repository';
import legalModule from '../../legal';
const { privacyPolicyRepository } = legalModule;
import iamModule from '../../iam';
const { roleRepository } = iamModule;
import notificationModule from '../../notification';
const { notificationTypeRepository } = notificationModule;
import AppError from '../../../shared/http/app-error.util';
import type PrismaRepository from '../../../shared/database/prisma.repository';
import { pageMetadata, pageRequest, type PageMetadata, type PageQuery, type PageRequest } from '../../../shared/http/pagination';
import type * as Q from '../requests/maintainers.request';
import redisClient from '../../../shared/infra/redis.util';
import maintainersDtoModule from '../responses/maintainers.response';
import auditModule from '../../audit';
const { audit } = auditModule;
import type { AuditActionKey } from '../../audit';
const {
  ListGendersResponseDTO,
  ListDocumentTypesResponseDTO,
  ListPhonePrefixesResponseDTO,
  ListAvatarsResponseDTO,
  ListAvatarThemesResponseDTO,
  ListCountriesResponseDTO,
  ListDepartmentsResponseDTO,
  ListCitiesResponseDTO,
  ActivePrivacyPolicyResponseDTO,
  ListRolesResponseDTO,
  ListNotificationTypesResponseDTO
} = maintainersDtoModule;

// Cache Redis de la política de privacidad activa (key fija, TTL 12 h)
const PRIVACY_POLICY_CACHE_KEY = 'cache:privacy-policy:active';
const PRIVACY_POLICY_CACHE_TTL_SECONDS = 43200; // 12 horas

class MaintainersService {
  genderRepository: typeof genderRepository;
  documentTypeRepository: typeof documentTypeRepository;
  phonePrefixRepository: typeof phonePrefixRepository;
  avatarRepository: typeof avatarRepository;
  avatarThemeRepository: typeof avatarThemeRepository;
  countryRepository: typeof countryRepository;
  departmentRepository: typeof departmentRepository;
  cityRepository: typeof cityRepository;
  privacyPolicyRepository: typeof privacyPolicyRepository;
  roleRepository: typeof roleRepository;
  notificationTypeRepository: typeof notificationTypeRepository;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new MaintainersService({ genderRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: MaintainersService.Deps = {}) {
    this.genderRepository = deps.genderRepository ?? genderRepository;
    this.documentTypeRepository = deps.documentTypeRepository ?? documentTypeRepository;
    this.phonePrefixRepository = deps.phonePrefixRepository ?? phonePrefixRepository;
    this.avatarRepository = deps.avatarRepository ?? avatarRepository;
    this.avatarThemeRepository = deps.avatarThemeRepository ?? avatarThemeRepository;
    this.countryRepository = deps.countryRepository ?? countryRepository;
    this.departmentRepository = deps.departmentRepository ?? departmentRepository;
    this.cityRepository = deps.cityRepository ?? cityRepository;
    this.privacyPolicyRepository = deps.privacyPolicyRepository ?? privacyPolicyRepository;
    this.roleRepository = deps.roleRepository ?? roleRepository;
    this.notificationTypeRepository = deps.notificationTypeRepository ?? notificationTypeRepository;
  }

  // Rutas públicas — userId puede ser null si no hay sesión activa
  // Se auditan para detectar scraping o reconocimiento previo a ataques.
  // `query` es la ya validada por el esquema de la ruta (requests/maintainers.request.ts).

  listGenders(query: Q.GenderListQuery, userId: string | null = null) {
    return this._list({
      repository: this.genderRepository,
      query,
      filters: { isActive: query.isActive ?? undefined },
      auditAction: 'MAINTAINER_GENDERS_VIEWED',
      userId,
      DTO: ListGendersResponseDTO
    });
  }

  /** Selector del formulario: todos los visibles, por nombre (sin paginar). */
  async listDocumentTypes(userId: string | null = null) {
    const items = await this.documentTypeRepository.findAllVisibleToClient();
    await audit.record('MAINTAINER_DOCUMENT_TYPES_VIEWED', {
      actorId: userId,
      details: { totalItems: items.length },
      entityType: 'Catalog',
      entityTable: null
    });
    return ListDocumentTypesResponseDTO(items, pageMetadata({ page: 1, limit: items.length || 1, sortBy: 'name', order: 'ASC' }, items.length));
  }

  listPhonePrefixes(query: Q.PhonePrefixListQuery, userId: string | null = null) {
    return this._list({
      repository: this.phonePrefixRepository,
      query,
      filters: { isActive: query.isActive ?? undefined, countryId: query.countryId },
      auditAction: 'MAINTAINER_PHONE_PREFIXES_VIEWED',
      userId,
      DTO: ListPhonePrefixesResponseDTO
    });
  }

  listAvatars(query: Q.AvatarListQuery, userId: string | null = null) {
    return this._list({
      repository: this.avatarRepository,
      query,
      filters: { isActive: query.isActive ?? undefined, themeId: query.themeId },
      auditAction: 'MAINTAINER_AVATARS_VIEWED',
      userId,
      DTO: ListAvatarsResponseDTO
    });
  }

  listAvatarThemes(query: Q.AvatarThemeListQuery, userId: string | null = null) {
    return this._list({
      repository: this.avatarThemeRepository,
      query,
      filters: { isActive: query.isActive ?? undefined },
      auditAction: 'MAINTAINER_AVATAR_THEMES_VIEWED',
      userId,
      DTO: ListAvatarThemesResponseDTO
    });
  }

  listCountries(query: Q.CountryListQuery, userId: string | null = null) {
    return this._list({
      repository: this.countryRepository,
      query,
      filters: { isActive: query.isActive ?? undefined },
      auditAction: 'MAINTAINER_COUNTRIES_VIEWED',
      userId,
      DTO: ListCountriesResponseDTO
    });
  }

  listDepartments(query: Q.DepartmentListQuery, userId: string | null = null) {
    return this._list({
      repository: this.departmentRepository,
      query,
      filters: { isActive: query.isActive ?? undefined, countryId: query.countryId },
      auditAction: 'MAINTAINER_DEPARTMENTS_VIEWED',
      userId,
      DTO: ListDepartmentsResponseDTO
    });
  }

  listCities(query: Q.CityListQuery, userId: string | null = null) {
    return this._list({
      repository: this.cityRepository,
      query,
      filters: { isActive: query.isActive ?? undefined, departmentId: query.departmentId },
      auditAction: 'MAINTAINER_CITIES_VIEWED',
      userId,
      DTO: ListCitiesResponseDTO
    });
  }

  listRoles(query: Q.RoleListQuery, userId: string | null = null) {
    return this._list({
      repository: this.roleRepository,
      query,
      filters: { isActive: query.isActive ?? undefined },
      auditAction: 'MAINTAINER_ROLES_VIEWED',
      userId,
      DTO: ListRolesResponseDTO
    });
  }

  listNotificationTypes(query: Q.NotificationTypeCatalogListQuery, userId: string | null = null) {
    return this._list({
      repository: this.notificationTypeRepository,
      query,
      filters: { isActive: query.isActive ?? undefined },
      auditAction: 'MAINTAINER_NOTIFICATION_TYPES_VIEWED',
      userId,
      DTO: ListNotificationTypesResponseDTO
    });
  }

  // Retorna la versión activa del documento legal (Política de Privacidad / T&C).
  // Cache-aside Redis (TTL 12 h). logAudit se ejecuta SIEMPRE, también en cache hit.
  async getActivePrivacyPolicy() {
    const cached = await redisClient.get<ReturnType<typeof ActivePrivacyPolicyResponseDTO>>(PRIVACY_POLICY_CACHE_KEY);
    if (cached) {
      await audit.record('PRIVACY_POLICY_VIEWED', {
        actorId: null,
        details: { version: cached.version },
        entityType: 'Catalog',
        entityTable: null
      });
      return cached;
    }

    const policy = await this.privacyPolicyRepository.findActive();
    if (!policy) {
      throw AppError.notFound('No hay una política de privacidad activa configurada');
    }
    const responseDto = ActivePrivacyPolicyResponseDTO(policy);
    await audit.record('PRIVACY_POLICY_VIEWED', {
      actorId: null,
      details: { version: policy.version },
      entityType: 'Catalog',
      entityTable: null
    });
    await redisClient.set(PRIVACY_POLICY_CACHE_KEY, responseDto, PRIVACY_POLICY_CACHE_TTL_SECONDS);
    return responseDto;
  }

  /** @private */
  async _list<T, R>({
    repository,
    query,
    filters,
    auditAction,
    userId,
    DTO
  }: {
    repository: MaintainersService.PaginatedSource<T>;
    query: PageQuery & { search?: string };
    filters: PrismaRepository.Filters;
    auditAction?: AuditActionKey;
    userId?: string | null;
    DTO: (rows: T[], metadata: PageMetadata) => R;
  }) {
    const page = pageRequest(query);
    const { rows, count } = await repository.findAllPaginated(filters, page, query.search);

    if (auditAction) {
      await audit.record(auditAction, {
        actorId: userId,
        details: { totalItems: count, page: page.page },
        entityType: 'Catalog',
        entityTable: null
      });
    }

    return DTO(rows, pageMetadata(page, count, { search: query.search, ...filters }));
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace MaintainersService {
  /** Lo que _list necesita de un repositorio: el listado paginado estándar. */
  export interface PaginatedSource<T> {
    findAllPaginated(filters: PrismaRepository.Filters, page: PageRequest, searchTerm?: string | null): Promise<{ rows: T[]; count: number }>;
  }

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    genderRepository?: typeof genderRepository;
    documentTypeRepository?: typeof documentTypeRepository;
    phonePrefixRepository?: typeof phonePrefixRepository;
    avatarRepository?: typeof avatarRepository;
    avatarThemeRepository?: typeof avatarThemeRepository;
    countryRepository?: typeof countryRepository;
    departmentRepository?: typeof departmentRepository;
    cityRepository?: typeof cityRepository;
    privacyPolicyRepository?: typeof privacyPolicyRepository;
    roleRepository?: typeof roleRepository;
    notificationTypeRepository?: typeof notificationTypeRepository;
  }
}

export default Object.assign(new MaintainersService(), { MaintainersService });
