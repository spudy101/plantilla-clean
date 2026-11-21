// Controlador HTTP de los banners públicos (landing + app cliente).
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import type { ListPublicBanners } from '../../application/use-cases/list-public-banners.use-case';

const { asyncHandler } = errorMiddlewareModule;

export class PublicPromotionalBannerController {
  constructor(private readonly listPublicBanners: ListPublicBanners) {}

  /** GET /promotional-banners — público */
  list = asyncHandler(async (_req: Request, res: Response) =>
    ApiResponse.success(res, 'Banners promocionales obtenidos exitosamente', await this.listPublicBanners.execute())
  );
}
