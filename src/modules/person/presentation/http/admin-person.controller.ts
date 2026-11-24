// Controlador HTTP del panel de clientes (admin): traduce la petición a la entrada del caso de uso y su salida a
// la respuesta. No tiene reglas.
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import routeParamUtilModule from '../../../../shared/presentation/http/route-param.util';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import adminAuditContextUtilModule from '../../../../shared/presentation/http/admin-audit-context.util';
import { validQuery } from '../../../../shared/presentation/validation/validate';
import { DeletedPersonListQuery, PersonListQuery } from './requests/person.request';
import type { CreateClientAccount } from '../../application/use-cases/create-client-account.use-case';
import type {
  GetClientAccount,
  ListClientAccounts,
  ListClientRoleOptions,
  ListDeletedClientAccounts
} from '../../application/use-cases/client-account-queries.use-cases';
import type { ChangeClientRole, SetClientAccountStatus } from '../../application/use-cases/client-account-access.use-cases';
import type {
  ChangeClientEmail,
  ChangeClientNationalId,
  DisableClientMfa,
  ResetClientPassword
} from '../../application/use-cases/client-account-credentials.use-cases';
import type { RequestClientAccountDeletion } from '../../application/use-cases/client-account-deletion.use-cases';

const { asyncHandler } = errorMiddlewareModule;
const { routeParam } = routeParamUtilModule;
const { requireAuthUser } = authUserUtilModule;
const { adminAuditContext } = adminAuditContextUtilModule;

export interface AdminPersonUseCases {
  list: ListClientAccounts;
  listDeleted: ListDeletedClientAccounts;
  listRoleOptions: ListClientRoleOptions;
  get: GetClientAccount;
  create: CreateClientAccount;
  activate: SetClientAccountStatus;
  deactivate: SetClientAccountStatus;
  resetPassword: ResetClientPassword;
  disableMfa: DisableClientMfa;
  changeEmail: ChangeClientEmail;
  changeNationalId: ChangeClientNationalId;
  changeRole: ChangeClientRole;
  requestDeletion: RequestClientAccountDeletion;
}

export class AdminPersonController {
  constructor(private readonly useCases: AdminPersonUseCases) {}

  /** GET /person */
  list = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.list.execute({ actorId: requireAuthUser(req).userId, query: validQuery(req, PersonListQuery) });
    return ApiResponse.success(res, 'Usuarios obtenidos exitosamente', data);
  });

  /** GET /person/deleted — listado histórico de clientes eliminados (solo lectura) */
  listDeleted = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.listDeleted.execute({ actorId: requireAuthUser(req).userId, query: validQuery(req, DeletedPersonListQuery) });
    return ApiResponse.success(res, 'Clientes eliminados obtenidos exitosamente', data);
  });

  /** GET /person/roles — roles de cliente para el filtro del listado */
  listRoleOptions = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.listRoleOptions.execute({ actorId: requireAuthUser(req).userId });
    return ApiResponse.success(res, 'Roles de cliente obtenidos exitosamente', data);
  });

  /** GET /person/:userId */
  getById = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.get.execute({ actorId: requireAuthUser(req).userId, userId: routeParam(req, 'userId') });
    return ApiResponse.success(res, 'Detalle de usuario obtenido correctamente', data);
  });

  /** POST /person */
  create = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.create.execute({ data: req.body, ctx: adminAuditContext(req, res) });
    return ApiResponse.success(res, 'Usuario creado exitosamente', data, 201);
  });

  /** PUT /person/:userId/activate */
  activate = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.activate.execute({ userId: routeParam(req, 'userId'), ctx: adminAuditContext(req, res) });
    return ApiResponse.success(res, 'Usuario activado exitosamente', data);
  });

  /** PUT /person/:userId/deactivate */
  deactivate = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.deactivate.execute({ userId: routeParam(req, 'userId'), ctx: adminAuditContext(req, res) });
    return ApiResponse.success(res, 'Usuario desactivado exitosamente', data);
  });

  /** PUT /person/:userId/reset-password */
  resetPassword = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.resetPassword.execute({ userId: routeParam(req, 'userId'), ctx: adminAuditContext(req, res) });
    return ApiResponse.success(res, 'Contraseña reseteada exitosamente', data);
  });

  /** PUT /person/:userId/disable-mfa */
  disableMFA = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.disableMfa.execute({ userId: routeParam(req, 'userId'), ctx: adminAuditContext(req, res) });
    return ApiResponse.success(res, 'MFA desactivado exitosamente', data);
  });

  /** PUT /person/:userId/email */
  changeEmail = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.changeEmail.execute({
      userId: routeParam(req, 'userId'),
      newEmail: req.body.newEmail,
      ctx: adminAuditContext(req, res)
    });
    return ApiResponse.success(res, 'Email actualizado exitosamente', data);
  });

  /** PUT /person/:userId/national-id */
  changeNationalId = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.changeNationalId.execute({
      userId: routeParam(req, 'userId'),
      newNationalId: req.body.newNationalId,
      ctx: adminAuditContext(req, res)
    });
    return ApiResponse.success(res, 'National ID actualizado exitosamente', data);
  });

  /** PUT /person/:userId/role */
  changeRole = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.changeRole.execute({
      userId: routeParam(req, 'userId'),
      newRoleId: req.body.newRoleId,
      ctx: adminAuditContext(req, res)
    });
    return ApiResponse.success(res, 'Rol actualizado exitosamente', data);
  });

  /** DELETE /person/:userId/delete-account — 202 si queda pendiente de la segunda aprobación */
  deleteAccount = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.useCases.requestDeletion.execute({
      userId: routeParam(req, 'userId'),
      currentPassword: req.body.currentPassword,
      ctx: adminAuditContext(req, res)
    });
    if (result?.pending) {
      return ApiResponse.accepted(res, 'Eliminación pendiente de segunda aprobación', result.approvalRequest);
    }
    return ApiResponse.success(res, 'Cuenta eliminada exitosamente');
  });
}
