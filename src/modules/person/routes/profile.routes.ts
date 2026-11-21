import express from 'express';
import { validate } from '../../../shared/presentation/validation/validate';
import { UpdateProfileBody, UpdateEmailBody, UpdatePhoneBody, UpdatePasswordBody, UpdateNamesBody, DeleteAccountBody } from '../requests/person.request';
const router = express.Router();
import ProfileController from '../controllers/profile.controller';
import iamModule from '../../iam';
const { AuthMiddleware } = iamModule;
import RequestLockMiddleware from '../../../shared/presentation/http/request-lock.middleware';
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';

/**
 * TODAS LAS RUTAS REQUIEREN AUTENTICACIÓN
 */

/** GET /profile */
router.get(
  '/person/profile',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  ProfileController.getProfile
);

/** GET /person/profile/extended */
router.get(
  '/person/profile/extended',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  ProfileController.getExtendedProfile
);

/** GET /person/profile/location */
router.get(
  '/person/profile/location',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  ProfileController.getLocation
);

/** GET /person/profile/contact */
router.get(
  '/person/profile/contact',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  ProfileController.getContactInfo
);

/** PUT /profile */
router.put(
  '/person/profile',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: UpdateProfileBody }),
  ProfileController.updateProfile
);

/** PUT /person/profile/email */
router.put(
  '/person/profile/email',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: UpdateEmailBody }),
  ProfileController.updateEmail
);

/** PUT /person/profile/phone */
router.put(
  '/person/profile/phone',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: UpdatePhoneBody }),
  ProfileController.updatePhone
);

/** PUT /person/profile/password */
router.put(
  '/person/profile/password',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: UpdatePasswordBody }),
  ProfileController.updatePassword
);

// El documento de identidad (RUT + tipo) es inmutable para el propio usuario: se fija en el registro.
// Su corrección es potestad del admin (PUT /kyc/person/:userId/national-id, con maker-checker).

/** PUT /person/profile/names */
router.put(
  '/person/profile/names',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: UpdateNamesBody }),
  ProfileController.updateNames
);

/** DELETE /person/profile/delete-account */
router.delete(
  '/person/profile/delete-account',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: DeleteAccountBody }),
  ProfileController.deleteAccount
);

export default router;
