// Controlador HTTP de catálogos: lee la query ya validada, la pasa al caso de uso y responde.
// No tiene reglas de negocio ni sabe de la base.
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import { validQuery } from '../../../../shared/presentation/validation/validate';
import type { ListCatalogInput } from '../../application/use-cases/list-catalog.use-case';
import type { ListClientDocumentTypes } from '../../application/use-cases/list-client-document-types.use-case';
import type { GetActivePrivacyPolicy } from '../../application/use-cases/get-active-privacy-policy.use-case';
import type { CatalogFilters } from '../../application/ports/catalog-reader.port';
import type { ListOutput } from '../../application/dto/catalog.output';
import * as requests from './requests/catalog-list.request';

const { asyncHandler } = errorMiddlewareModule;

/** Lo que el controlador necesita de un caso de uso de listado (ListCatalog de cualquier catálogo). */
interface ListCatalogUseCase {
  execute(input: ListCatalogInput): Promise<ListOutput<unknown>>;
}

/** Los casos de uso que expone el controlador (los arma catalogs.module.ts). */
export interface CatalogUseCases {
  listGenders: ListCatalogUseCase;
  listPhonePrefixes: ListCatalogUseCase;
  listAvatars: ListCatalogUseCase;
  listAvatarThemes: ListCatalogUseCase;
  listCountries: ListCatalogUseCase;
  listDepartments: ListCatalogUseCase;
  listCities: ListCatalogUseCase;
  listRoles: ListCatalogUseCase;
  listNotificationTypes: ListCatalogUseCase;
  listClientDocumentTypes: ListClientDocumentTypes;
  getActivePrivacyPolicy: GetActivePrivacyPolicy;
}

type ListQuery = requests.GenderListQuery & { countryId?: string; departmentId?: string; themeId?: string };

/** Un endpoint de listado: valida la query, separa paginación de filtros y responde con `message`. */
function listHandler<Q extends ListQuery>(
  useCase: ListCatalogUseCase,
  schema: Parameters<typeof validQuery>[1],
  message: string,
  filtersOf: (query: Q) => CatalogFilters
) {
  return asyncHandler(async (req: Request, res: Response) => {
    const query = validQuery(req, schema) as Q;
    const { page, limit, sortBy, order, search } = query;
    const data = await useCase.execute({ page: { page, limit, sortBy, order }, search, filters: filtersOf(query) });
    return ApiResponse.success(res, message, data);
  });
}

/** `isActive` vacío llega como null: es "sin filtro". */
const active = (query: ListQuery): CatalogFilters => ({ isActive: query.isActive ?? undefined });

export class CatalogsController {
  readonly listGenders;
  readonly listPhonePrefixes;
  readonly listAvatars;
  readonly listAvatarThemes;
  readonly listCountries;
  readonly listDepartments;
  readonly listCities;
  readonly listRoles;
  readonly listNotificationTypes;

  constructor(private readonly useCases: CatalogUseCases) {
    this.listGenders = listHandler(useCases.listGenders, requests.GenderListQuery, 'Géneros obtenidos exitosamente', active);
    this.listPhonePrefixes = listHandler(
      useCases.listPhonePrefixes,
      requests.PhonePrefixListQuery,
      'Prefijos telefónicos obtenidos exitosamente',
      q => ({
        ...active(q),
        countryId: q.countryId
      })
    );
    this.listAvatars = listHandler(useCases.listAvatars, requests.AvatarListQuery, 'Avatares obtenidos exitosamente', q => ({
      ...active(q),
      themeId: q.themeId
    }));
    this.listAvatarThemes = listHandler(
      useCases.listAvatarThemes,
      requests.AvatarThemeListQuery,
      'Temas de avatares obtenidos exitosamente',
      active
    );
    this.listCountries = listHandler(useCases.listCountries, requests.CountryListQuery, 'Países obtenidos exitosamente', active);
    this.listDepartments = listHandler(
      useCases.listDepartments,
      requests.DepartmentListQuery,
      'Departamentos obtenidos exitosamente',
      q => ({
        ...active(q),
        countryId: q.countryId
      })
    );
    this.listCities = listHandler(useCases.listCities, requests.CityListQuery, 'Ciudades obtenidas exitosamente', q => ({
      ...active(q),
      departmentId: q.departmentId
    }));
    this.listRoles = listHandler(useCases.listRoles, requests.RoleListQuery, 'Roles obtenidos exitosamente', active);
    this.listNotificationTypes = listHandler(
      useCases.listNotificationTypes,
      requests.NotificationTypeCatalogListQuery,
      'Tipos de notificación obtenidos exitosamente',
      active
    );
  }

  listDocumentTypes = asyncHandler(async (_req: Request, res: Response) =>
    ApiResponse.success(res, 'Tipos de documento obtenidos exitosamente', await this.useCases.listClientDocumentTypes.execute())
  );

  getActivePrivacyPolicy = asyncHandler(async (_req: Request, res: Response) =>
    ApiResponse.success(
      res,
      'Política de privacidad activa obtenida exitosamente',
      await this.useCases.getActivePrivacyPolicy.execute()
    )
  );
}
