import PromotionalBannerPublicService from '../services/promotional-banner.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;

class PromotionalBannerPublicController {
  /** GET /promotional-banners — público (landing + app cliente) */
  list = asyncHandler(async (req, res) => {
    const result = await PromotionalBannerPublicService.getActiveBanners();
    return ApiResponse.success(res, 'Banners promocionales obtenidos exitosamente', result);
  });
}

export default new PromotionalBannerPublicController();
