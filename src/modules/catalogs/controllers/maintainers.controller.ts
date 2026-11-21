import MaintainersService from '../services/maintainers.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import { validQuery } from '../../../shared/validation/validate';
import {
  AvatarListQuery,
  AvatarThemeListQuery,
  CityListQuery,
  CountryListQuery,
  DepartmentListQuery,
  GenderListQuery,
  NotificationTypeCatalogListQuery,
  PhonePrefixListQuery,
  RoleListQuery
} from '../requests/maintainers.request';

class MaintainersController {
  listGenders = asyncHandler(async (req, res) => {
    return ApiResponse.success(res, 'Géneros obtenidos exitosamente', await MaintainersService.listGenders(validQuery(req, GenderListQuery)));
  });

  listDocumentTypes = asyncHandler(async (req, res) => {
    return ApiResponse.success(
      res,
      'Tipos de documento obtenidos exitosamente',
      await MaintainersService.listDocumentTypes()
    );
  });

  listPhonePrefixes = asyncHandler(async (req, res) => {
    return ApiResponse.success(
      res,
      'Prefijos telefónicos obtenidos exitosamente',
      await MaintainersService.listPhonePrefixes(validQuery(req, PhonePrefixListQuery))
    );
  });
  listAvatars = asyncHandler(async (req, res) => {
    return ApiResponse.success(res, 'Avatares obtenidos exitosamente', await MaintainersService.listAvatars(validQuery(req, AvatarListQuery)));
  });
  listAvatarThemes = asyncHandler(async (req, res) => {
    return ApiResponse.success(
      res,
      'Temas de avatares obtenidos exitosamente',
      await MaintainersService.listAvatarThemes(validQuery(req, AvatarThemeListQuery))
    );
  });
  listCountries = asyncHandler(async (req, res) => {
    return ApiResponse.success(res, 'Países obtenidos exitosamente', await MaintainersService.listCountries(validQuery(req, CountryListQuery)));
  });
  listDepartments = asyncHandler(async (req, res) => {
    return ApiResponse.success(res, 'Departamentos obtenidos exitosamente', await MaintainersService.listDepartments(validQuery(req, DepartmentListQuery)));
  });
  listCities = asyncHandler(async (req, res) => {
    return ApiResponse.success(res, 'Ciudades obtenidas exitosamente', await MaintainersService.listCities(validQuery(req, CityListQuery)));
  });
  listNotificationTypes = asyncHandler(async (req, res) => {
    return ApiResponse.success(
      res,
      'Tipos de notificación obtenidos exitosamente',
      await MaintainersService.listNotificationTypes(validQuery(req, NotificationTypeCatalogListQuery))
    );
  });
  listRoles = asyncHandler(async (req, res) => {
    return ApiResponse.success(res, 'Roles obtenidos exitosamente', await MaintainersService.listRoles(validQuery(req, RoleListQuery)));
  });
  getActivePrivacyPolicy = asyncHandler(async (req, res) => {
    return ApiResponse.success(
      res,
      'Política de privacidad activa obtenida exitosamente',
      await MaintainersService.getActivePrivacyPolicy()
    );
  });
}

export default new MaintainersController();
