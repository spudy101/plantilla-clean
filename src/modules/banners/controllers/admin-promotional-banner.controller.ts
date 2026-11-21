import PromotionalBannerService from '../services/admin-promotional-banner.service';
import ApiResponse from '../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../shared/presentation/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import type { ReplaceBannersBody } from '../requests/admin-promotional-banner.request';
import authUserUtilModule from '../../../shared/presentation/http/auth-user.util';
const { requireAuthUser } = authUserUtilModule;

class PromotionalBannerController {
  /** GET /promotional-banners */
  list = asyncHandler(async (req, res) => {
    const result = await PromotionalBannerService.list(requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Banners promocionales obtenidos exitosamente', result);
  });

  /** PUT /promotional-banners — reemplaza el catálogo completo */
  replace = asyncHandler(async (req, res) => {
    // validate() ya dejó en req.body el valor parseado del esquema
    const { banners } = req.body as ReplaceBannersBody;
    const result = await PromotionalBannerService.replace(banners, requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Banners promocionales actualizados exitosamente', result);
  });

  /** POST /promotional-banners/image — multipart, campo "image" */
  uploadImage = asyncHandler(async (req, res) => {
    // uploadFields([{ name: 'image' }]) → req.files es un mapa campo → archivos
    const files = req.files as Record<string, Express.Multer.File[] | undefined> | undefined;
    const file = files?.image?.[0] ?? null;
    const result = await PromotionalBannerService.uploadImage(file, requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Imagen del banner subida exitosamente', result, 201);
  });
}

export default new PromotionalBannerController();
