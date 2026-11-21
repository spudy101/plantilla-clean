import NotificationCategoryService from '../services/admin-notification-category.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import routeParamUtilModule from '../../../shared/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authUserUtilModule from '../../../shared/http/auth-user.util';
import { validQuery } from '../../../shared/validation/validate';
import { CategoryListQuery } from '../requests/notification.request';
const { requireAuthUser } = authUserUtilModule;

class NotificationCategoryController {
  /** GET /notification-categories */
  list = asyncHandler(async (req, res) => {
    const result = await NotificationCategoryService.list(validQuery(req, CategoryListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Categorías de notificación obtenidas exitosamente', result);
  });

  /** GET /notification-categories/:notificationCategoryId */
  getById = asyncHandler(async (req, res) => {
    const result = await NotificationCategoryService.getById(routeParam(req, 'notificationCategoryId'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Categoría de notificación obtenida exitosamente', result);
  });

  /** POST /notification-categories */
  create = asyncHandler(async (req, res) => {
    const result = await NotificationCategoryService.create(req.body, requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Categoría de notificación creada exitosamente', result, 201);
  });

  /** PATCH /notification-categories/:notificationCategoryId */
  update = asyncHandler(async (req, res) => {
    const result = await NotificationCategoryService.update(routeParam(req, 'notificationCategoryId'), req.body, requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Categoría de notificación actualizada exitosamente', result);
  });

  /** DELETE /notification-categories/:notificationCategoryId */
  remove = asyncHandler(async (req, res) => {
    const result = await NotificationCategoryService.remove(routeParam(req, 'notificationCategoryId'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Categoría de notificación eliminada exitosamente', result);
  });
}

export default new NotificationCategoryController();
