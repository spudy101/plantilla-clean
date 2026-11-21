import ProfileService from '../services/profile.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import authUserUtilModule from '../../../shared/http/auth-user.util';
const { requireAuthUser, requireAuthPerson } = authUserUtilModule;

class ProfileController {
  /** GET /profile */
  getProfile = asyncHandler(async (req, res) => {
    const result = await ProfileService.getProfile(requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Perfil básico obtenido exitosamente', result);
  });

  /** GET /profile/extended */
  getExtendedProfile = asyncHandler(async (req, res) => {
    const result = await ProfileService.getExtendedProfile(requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Perfil extendido obtenido exitosamente', result);
  });

  /** GET /profile/location */
  getLocation = asyncHandler(async (req, res) => {
    const user = requireAuthPerson(req);
    const result = await ProfileService.getLocation(user.personId, user.userId);
    return ApiResponse.success(res, 'Ubicación obtenida exitosamente', result);
  });

  /** GET /profile/contact */
  getContactInfo = asyncHandler(async (req, res) => {
    const user = requireAuthPerson(req);
    const result = await ProfileService.getContactInfo(user.personId, user.userId);
    return ApiResponse.success(res, 'Información de contacto obtenida exitosamente', result);
  });

  /** PUT /profile */
  updateProfile = asyncHandler(async (req, res) => {
    const user = requireAuthPerson(req);
    const result = await ProfileService.updateProfile(
      req.body,
      user.userId,
      user.personId,
      user.username,
      user.firstName,
      res.locals.auditContext
    );
    return ApiResponse.success(res, 'Perfil actualizado exitosamente', result);
  });

  /** PUT /profile/email */
  updateEmail = asyncHandler(async (req, res) => {
    const user = requireAuthPerson(req);
    const result = await ProfileService.updateEmail(
      req.body,
      user.userId,
      user.personId,
      user.firstName,
      res.locals.auditContext
    );
    return ApiResponse.success(res, 'Email actualizado exitosamente', result);
  });

  /** PUT /profile/phone */
  updatePhone = asyncHandler(async (req, res) => {
    const user = requireAuthPerson(req);
    const result = await ProfileService.updatePhone(
      req.body,
      user.userId,
      user.personId,
      user.firstName,
      res.locals.auditContext
    );
    return ApiResponse.success(res, 'Teléfono actualizado exitosamente', result);
  });

  /** PUT /profile/password */
  updatePassword = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    await ProfileService.updatePassword(
      req.body,
      user.userId,
      user.firstName,
      res.locals.auditContext
    );
    return ApiResponse.success(res, 'Contraseña actualizada exitosamente');
  });

  /** PUT /profile/names */
  updateNames = asyncHandler(async (req, res) => {
    const user = requireAuthPerson(req);
    const result = await ProfileService.updateNames(
      req.body,
      user.userId,
      user.personId,
      user.firstName,
      res.locals.auditContext
    );
    return ApiResponse.success(res, 'Nombres actualizados exitosamente', result);
  });

  /** DELETE /profile/delete-account */
  deleteAccount = asyncHandler(async (req, res) => {
    const user = requireAuthPerson(req);
    await ProfileService.deleteAccount(req.body, {
      userId: user.userId,
      personId: user.personId,
      nationalId: user.nationalId,
      email: user.email,
      firstName: user.firstName,
      auditContext: res.locals.auditContext
    });
    return ApiResponse.success(res, 'Cuenta eliminada exitosamente');
  });
}

export default new ProfileController();
