// ============================================================
// auth-biometric.routes.ts
// ============================================================

import express from 'express';
import { validate } from '../../../shared/validation/validate';
import { BiometricLoginStartBody, BiometricLoginFinishBody, BiometricRegisterFinishBody, BiometricCredentialParams } from '../requests/iam.request';
const router = express.Router();
import AuthBiometricController from '../controllers/auth-biometric.controller';
import AuthMiddleware from '../middlewares/auth.middleware';
import RateLimitMiddleware from '../../../shared/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/http/request-lock.middleware';

// ============================================================
// PUBLIC
// ============================================================

/**
 * POST /auth/biometric/login/start
 * Genera challenge para autenticación biométrica.
 * Recibe nationalId para identificar al usuario.
 */
router.post(
  '/biometric/login/start',
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forPublicEndpoints(),
  validate({ body: BiometricLoginStartBody }),
  AuthBiometricController.loginStart
);

/**
 * POST /auth/biometric/login/finish
 * Verifica la firma y devuelve tokens.
 */
router.post(
  '/biometric/login/finish',
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forPublicEndpoints(),
  validate({ body: BiometricLoginFinishBody }),
  AuthBiometricController.loginFinish
);

// ============================================================
// PROTECTED (requiere token válido + dispositivo TRUSTED)
// ============================================================

/**
 * POST /auth/biometric/register/start
 * Genera challenge para registro de huella.
 * Solo desde dispositivo TRUSTED.
 */
router.post(
  '/biometric/register/start',
  AuthMiddleware.authenticate,
  RequestLockMiddleware.forAuthenticatedUsers(),
  AuthBiometricController.registerStart
);

/**
 * POST /auth/biometric/register/finish
 * Recibe llave pública y firma, registra la credencial.
 */
router.post(
  '/biometric/register/finish',
  AuthMiddleware.authenticate,
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: BiometricRegisterFinishBody }),
  AuthBiometricController.registerFinish
);

/**
 * GET /auth/biometric/credentials
 * Lista las credenciales biométricas del usuario.
 */
router.get(
  '/biometric/credentials',
  AuthMiddleware.authenticate,
  RequestLockMiddleware.forAuthenticatedUsers(),
  AuthBiometricController.getCredentials
);

/**
 * DELETE /auth/biometric/:credentialId
 * Elimina (desactiva) una credencial biométrica.
 */
router.delete(
  '/biometric/:credentialId',
  AuthMiddleware.authenticate,
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: BiometricCredentialParams }),
  AuthBiometricController.deleteCredential
);

export default router;
