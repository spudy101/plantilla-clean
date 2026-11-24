// Controlador HTTP del perfil propio (admin y client): el titular sale de la sesión (req.user) y el resto de
// la petición. No tiene reglas.
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import type {
  GetOwnContact,
  GetOwnLocation,
  GetOwnProfile,
  UpdateOwnNames,
  UpdateOwnProfile
} from '../../application/use-cases/own-profile.use-cases';
import type {
  DeleteOwnAccount,
  UpdateOwnEmail,
  UpdateOwnPassword,
  UpdateOwnPhone
} from '../../application/use-cases/own-credentials.use-cases';

const { asyncHandler } = errorMiddlewareModule;
const { requireAuthUser, requireAuthPerson } = authUserUtilModule;

export interface ProfileUseCases {
  getProfile: GetOwnProfile;
  getExtendedProfile: GetOwnProfile;
  getContact: GetOwnContact;
  getLocation: GetOwnLocation;
  updateProfile: UpdateOwnProfile;
  updateEmail: UpdateOwnEmail;
  updatePhone: UpdateOwnPhone;
  updatePassword: UpdateOwnPassword;
  updateNames: UpdateOwnNames;
  deleteAccount: DeleteOwnAccount;
}

export class ProfileController {
  constructor(private readonly useCases: ProfileUseCases) {}

  /** GET /person/profile */
  getProfile = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.getProfile.execute({ userId: requireAuthUser(req).userId });
    return ApiResponse.success(res, 'Perfil básico obtenido exitosamente', data);
  });

  /** GET /person/profile/extended */
  getExtendedProfile = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.getExtendedProfile.execute({ userId: requireAuthUser(req).userId });
    return ApiResponse.success(res, 'Perfil extendido obtenido exitosamente', data);
  });

  /** GET /person/profile/location */
  getLocation = asyncHandler(async (req: Request, res: Response) => {
    const { userId, personId } = requireAuthPerson(req);
    const data = await this.useCases.getLocation.execute({ userId, personId });
    return ApiResponse.success(res, 'Ubicación obtenida exitosamente', data);
  });

  /** GET /person/profile/contact */
  getContactInfo = asyncHandler(async (req: Request, res: Response) => {
    const { userId, personId } = requireAuthPerson(req);
    const data = await this.useCases.getContact.execute({ userId, personId });
    return ApiResponse.success(res, 'Información de contacto obtenida exitosamente', data);
  });

  /** PUT /person/profile */
  updateProfile = asyncHandler(async (req: Request, res: Response) => {
    const { userId, personId, username, firstName } = requireAuthPerson(req);
    const data = await this.useCases.updateProfile.execute({ userId, personId, username, firstName, update: req.body });
    return ApiResponse.success(res, 'Perfil actualizado exitosamente', data);
  });

  /** PUT /person/profile/email */
  updateEmail = asyncHandler(async (req: Request, res: Response) => {
    const { userId, personId, firstName } = requireAuthPerson(req);
    const data = await this.useCases.updateEmail.execute({
      userId,
      personId,
      firstName,
      email: req.body.email,
      currentPassword: req.body.currentPassword
    });
    return ApiResponse.success(res, 'Email actualizado exitosamente', data);
  });

  /** PUT /person/profile/phone */
  updatePhone = asyncHandler(async (req: Request, res: Response) => {
    const { userId, personId, firstName } = requireAuthPerson(req);
    const { newPhone, phonePrefixId, phoneType } = req.body;
    const data = await this.useCases.updatePhone.execute({ userId, personId, firstName, newPhone, phonePrefixId, phoneType });
    return ApiResponse.success(res, 'Teléfono actualizado exitosamente', data);
  });

  /** PUT /person/profile/password */
  updatePassword = asyncHandler(async (req: Request, res: Response) => {
    const { userId, firstName } = requireAuthUser(req);
    await this.useCases.updatePassword.execute({
      userId,
      firstName,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword
    });
    return ApiResponse.success(res, 'Contraseña actualizada exitosamente');
  });

  /** PUT /person/profile/names */
  updateNames = asyncHandler(async (req: Request, res: Response) => {
    const { userId, personId, firstName } = requireAuthPerson(req);
    const data = await this.useCases.updateNames.execute({ userId, personId, firstName, names: req.body });
    return ApiResponse.success(res, 'Nombres actualizados exitosamente', data);
  });

  /** DELETE /person/profile/delete-account */
  deleteAccount = asyncHandler(async (req: Request, res: Response) => {
    const { userId, personId, nationalId, email, firstName } = requireAuthPerson(req);
    await this.useCases.deleteAccount.execute({ userId, personId, nationalId, email, firstName, currentPassword: req.body.currentPassword });
    return ApiResponse.success(res, 'Cuenta eliminada exitosamente');
  });
}
