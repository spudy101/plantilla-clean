// Controlador HTTP: traduce la petición a la entrada del caso de uso y su salida a la respuesta.
// No tiene reglas de negocio ni sabe de la base: solo HTTP ↔ caso de uso.
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import type { GetSystemGlobalConfig } from '../../application/use-cases/get-system-global-config.use-case';
import type { UpdateSystemGlobalConfig } from '../../application/use-cases/update-system-global-config.use-case';
import type { UpdateSystemGlobalConfigBody } from './requests/update-system-global-config.request';

const { asyncHandler } = errorMiddlewareModule;
const { requireAuthUser } = authUserUtilModule;

export class SystemGlobalConfigController {
  constructor(
    private readonly getConfigUseCase: GetSystemGlobalConfig,
    private readonly updateConfigUseCase: UpdateSystemGlobalConfig
  ) {}

  getConfig = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.getConfigUseCase.execute({ actorId: requireAuthUser(req).userId });
    return ApiResponse.success(res, 'Configuración global obtenida exitosamente', data);
  });

  updateConfig = asyncHandler(async (req: Request, res: Response) => {
    // El body ya viene validado y parseado por validate({ body: UpdateSystemGlobalConfigBody }) en la ruta
    const { auditHotPurgeEnabled, ...rest } = req.body as UpdateSystemGlobalConfigBody;
    // Un booleano vacío llega como null: es "no enviado", no un valor
    const patch = { ...rest, ...(auditHotPurgeEnabled != null ? { auditHotPurgeEnabled } : {}) };
    const data = await this.updateConfigUseCase.execute({ actorId: requireAuthUser(req).userId, patch });
    return ApiResponse.success(res, 'Configuración global actualizada exitosamente', data);
  });
}
