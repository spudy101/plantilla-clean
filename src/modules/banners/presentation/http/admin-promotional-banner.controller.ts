// Controlador HTTP del mantenedor admin de banners: HTTP ↔ casos de uso, sin reglas de negocio.
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import type { ListAdminBanners } from '../../application/use-cases/list-admin-banners.use-case';
import type { ReplaceBanners } from '../../application/use-cases/replace-banners.use-case';
import type { UploadBannerImage } from '../../application/use-cases/upload-banner-image.use-case';
import type { ReplaceBannersBody } from './requests/admin-promotional-banner.request';

const { asyncHandler } = errorMiddlewareModule;
const { requireAuthUser } = authUserUtilModule;

export class AdminPromotionalBannerController {
  constructor(
    private readonly listBanners: ListAdminBanners,
    private readonly replaceBanners: ReplaceBanners,
    private readonly uploadBannerImage: UploadBannerImage
  ) {}

  /** GET /promotional-banners */
  list = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.listBanners.execute({ actorId: requireAuthUser(req).userId });
    return ApiResponse.success(res, 'Banners promocionales obtenidos exitosamente', result);
  });

  /** PUT /promotional-banners — reemplaza el catálogo completo (validate() ya dejó el body parseado) */
  replace = asyncHandler(async (req: Request, res: Response) => {
    const { banners } = req.body as ReplaceBannersBody;
    const result = await this.replaceBanners.execute({ actorId: requireAuthUser(req).userId, banners });
    return ApiResponse.success(res, 'Banners promocionales actualizados exitosamente', result);
  });

  /** POST /promotional-banners/image — multipart, campo "image" */
  uploadImage = asyncHandler(async (req: Request, res: Response) => {
    // uploadFields([{ name: 'image' }]) → req.files es un mapa campo → archivos
    const files = req.files as Record<string, Express.Multer.File[] | undefined> | undefined;
    const file = files?.image?.[0] ?? null;
    const result = await this.uploadBannerImage.execute({ actorId: requireAuthUser(req).userId, file });
    return ApiResponse.success(res, 'Imagen del banner subida exitosamente', result, 201);
  });
}
