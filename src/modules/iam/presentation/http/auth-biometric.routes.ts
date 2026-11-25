// ============================================================
// auth-biometric.routes.ts
// ============================================================

import express from 'express';
import type { Router } from 'express';
import type { AuthBiometricController } from './auth.controllers';
import type { AuthGuards } from './auth.guards';
import { validate } from '../../../../shared/presentation/validation/validate';
import { BiometricLoginStartBody, BiometricLoginFinishBody, BiometricRegisterFinishBody, BiometricCredentialParams } from './requests/iam.request';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';

// ============================================================
// PUBLIC
// ============================================================

/**
 * POST /auth/biometric/login/start
 * Genera challenge para autenticación biométrica.
 * Recibe nationalId para identificar al usuario.
 */

export function createAuthBiometricRouter(controller: AuthBiometricController, guards: AuthGuards): Router {
  const router = express.Router();

  router.post(
    '/biometric/login/start',
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forPublicEndpoints(),
    validate({ body: BiometricLoginStartBody }),
    controller.loginStart
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
    controller.loginFinish
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
    guards.authenticate,
    RequestLockMiddleware.forAuthenticatedUsers(),
    controller.registerStart
  );

  /**
   * POST /auth/biometric/register/finish
   * Recibe llave pública y firma, registra la credencial.
   */
  router.post(
    '/biometric/register/finish',
    guards.authenticate,
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ body: BiometricRegisterFinishBody }),
    controller.registerFinish
  );

  /**
   * GET /auth/biometric/credentials
   * Lista las credenciales biométricas del usuario.
   */
  router.get(
    '/biometric/credentials',
    guards.authenticate,
    RequestLockMiddleware.forAuthenticatedUsers(),
    controller.getCredentials
  );

  /**
   * DELETE /auth/biometric/:credentialId
   * Elimina (desactiva) una credencial biométrica.
   */
  router.delete(
    '/biometric/:credentialId',
    guards.authenticate,
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ params: BiometricCredentialParams }),
    controller.deleteCredential
  );

  return router;
}
