// Casos de uso de la autenticación de cada request (los usan las guardas HTTP de presentation):
//
//   AuthenticateRequest       verifica el access token propio (RS256), el dispositivo, la blacklist y la inactividad
//                             de la sesión, y devuelve quién llama
//   VerifyRequestSignature    la firma HMAC de un request mobile (anti-replay)
//   RequirePrivilegedMfa      RF-ADM-01 #6: los roles internos deben tener 2FA activo para operar
//   AuthorizePermission       RBAC por módulo + acción (403 si no)
//   VerifyExternalApiKey      la X-API-Key de otro sistema
import {
  DeviceBlockedError,
  IamForbiddenError,
  IamRateLimitedError,
  IamUnauthorizedError,
  MfaRequiredError,
  SessionClosedError,
  AUTH_ERROR_CODES
} from '../../domain/errors';
import { idleMs, isIdleTooLong, shouldTouch } from '../../domain/session';
import { hasActiveMfa, isInternalRole } from '../../domain/user';
import type { IamDeps } from './iam-deps';
import type { PermissionResolver } from './rbac.use-cases';

const MFA_NOT_ACTIVE_LOG_MSG = 'Acción bloqueada — 2FA no activo';
const TIMESTAMP_TOLERANCE_SECONDS = 10;

/** Quién llama (lo que queda en req.user). */
export interface AuthenticatedCaller {
  sessionId: string | null;
  userId: string;
  personId: string | null;
  roleId: string | null;
  roleName: string | null;
  firstName: string | null;
  lastName: string | null;
  nationalId: string | null;
  username: string | null;
  authUsername: string | null;
  email: string | null;
  tokenIat: number | undefined;
  tokenExp: number | undefined;
  canal: 'web' | 'mobile';
}

export interface AuthenticationInput {
  accessToken: string;
  /** web: cookie httpOnly; mobile: header Authorization (y firma HMAC en producción). */
  canal: 'web' | 'mobile';
  /** Exige que el token traiga el rol. */
  requireRole: boolean;
  /** La huella del dispositivo (la calcula el middleware de auditoría). */
  fingerprintHash: string | null | undefined;
  /** Para los logs. */
  path: string;
  /** La firma del request mobile (solo se verifica en producción). */
  signature: SignedRequest;
}

export interface SignedRequest {
  timestamp?: string;
  signature?: string;
  deviceId?: string;
  method: string;
  path: string;
  ip?: string;
  userAgent?: string | string[];
}

// ============================================================
// FIRMA HMAC (mobile)
// ============================================================

export class VerifyRequestSignature {
  constructor(private readonly deps: Pick<IamDeps, 'devices' | 'requestSigner' | 'logger'>) {}

  /**
   * Headers: x-timestamp (unix ms en texto plano), x-signature (HMAC-SHA256 hex de `timestamp:method:path` con el
   * secreto del dispositivo) y x-device-id (la huella del dispositivo).
   */
  async execute({ timestamp, signature, deviceId: fingerprintHash, method, path, ip, userAgent }: SignedRequest): Promise<void> {
    const { devices, requestSigner, logger } = this.deps;
    if (!timestamp) {
      throw new IamUnauthorizedError('X-Timestamp header requerido');
    }
    if (!signature) {
      throw new IamUnauthorizedError('X-Signature header requerido');
    }
    if (!fingerprintHash) {
      throw new IamUnauthorizedError('X-Device-Id header requerido');
    }

    // 1. Ventana de tiempo
    const requestTime = Number.parseInt(timestamp, 10);
    if (Number.isNaN(requestTime)) {
      throw new IamUnauthorizedError('Timestamp inválido');
    }
    const diffSeconds = Math.abs(Date.now() - requestTime) / 1000;
    if (diffSeconds > TIMESTAMP_TOLERANCE_SECONDS) {
      logger.warn('HMAC — timestamp fuera de ventana', { diff: `${diffSeconds.toFixed(2)}s`, tolerance: `${TIMESTAMP_TOLERANCE_SECONDS}s`, ip });
      throw new IamUnauthorizedError(`Timestamp expirado. El request debe realizarse dentro de ${TIMESTAMP_TOLERANCE_SECONDS} segundos`);
    }

    // 2. El secreto del dispositivo (se guarda cifrado; llega descifrado)
    const device = await devices.findAnyByFingerprint(fingerprintHash);
    if (!device?.hmacSecret) {
      logger.warn('HMAC — dispositivo sin secret registrado', { fingerprintHash });
      throw new IamUnauthorizedError('Dispositivo no reconocido. Inicia sesión nuevamente.');
    }

    // 3. La firma
    const expected = requestSigner.sign(timestamp, method, path, device.hmacSecret);
    if (!requestSigner.matches(signature, expected)) {
      logger.warn('HMAC — firma inválida', { method, path, ip, userAgent });
      throw new IamUnauthorizedError('Firma de request inválida');
    }
  }
}

// ============================================================
// AUTENTICACIÓN
// ============================================================

type AuthenticateDeps = Pick<
  IamDeps,
  'tokens' | 'sessions' | 'devices' | 'revocations' | 'deviceBlocklist' | 'cache' | 'operationSession' | 'logger' | 'policy'
> & { verifySignature: VerifyRequestSignature };

export class AuthenticateRequest {
  constructor(private readonly deps: AuthenticateDeps) {}

  async execute({ accessToken, canal, requireRole, fingerprintHash, path, signature }: AuthenticationInput): Promise<AuthenticatedCaller> {
    const { tokens, verifySignature, logger, policy } = this.deps;

    // La firma HMAC del request (solo mobile en producción)
    if (policy.requireMobileSignature && canal === 'mobile') {
      await verifySignature.execute(signature);
    }

    // El JWT RS256 propio (una sola verificación)
    const decoded = await tokens.verifyAccessToken(accessToken);
    if (!decoded.userId) {
      logger.warn('JWT RS256 missing userId claim', { canal });
      throw new IamUnauthorizedError('Token inválido');
    }
    if (requireRole && (!decoded.roleId || !decoded.roleName)) {
      logger.warn('JWT RS256 missing role claims', { userId: decoded.userId, canal });
      throw new IamForbiddenError('Token sin rol asignado');
    }

    await this.checkDeviceBlocklist(decoded.userId, fingerprintHash, path);
    await this.checkTokenBlacklist(accessToken, decoded.userId, decoded.iat, decoded.sessionId);

    const caller: AuthenticatedCaller = {
      sessionId: decoded.sessionId || null,
      userId: decoded.userId,
      personId: decoded.personId || null,
      roleId: decoded.roleId || null,
      roleName: decoded.roleName || null,
      firstName: decoded.firstName || null,
      lastName: decoded.lastName || null,
      nationalId: decoded.nationalId || null,
      username: decoded.authUsername || null,
      authUsername: decoded.authUsername || null,
      email: decoded.email || null,
      tokenIat: decoded.iat,
      tokenExp: decoded.exp,
      canal
    };
    return caller;
  }

  /**
   * Lo que pasa DESPUÉS de dejar el usuario en el request: la sesión queda en el contexto de la operación (la
   * auditoría la persiste) y se aplica la inactividad. Separado de `execute` porque la presentación deja `req.user`
   * en el medio (así lo leía el control de inactividad).
   */
  /** La autenticación opcional falló a mitad de camino: el contexto de la operación vuelve a ser anónimo. */
  clearSession(): void {
    this.deps.operationSession.bind(null, null);
  }

  async afterAuthenticated(caller: AuthenticatedCaller): Promise<void> {
    this.deps.operationSession.bind(caller.sessionId, caller.userId);
    await this.enforceInactivity(caller);
    this.deps.logger.debug('User authenticated from JWT RS256', { userId: caller.userId, canal: caller.canal });
  }

  /**
   * [RF-AUTH-02] | CA-01, CA-04 | Inactividad unificada para clientes e internos: si last_access_at superó el límite,
   * se cierra la sesión en el acto y se responde 401. Si sigue activa, se renueva last_access_at (con throttle) para
   * reflejar la última vez que el usuario pegó a CUALQUIER API.
   */
  private async enforceInactivity({ sessionId, userId, roleName }: AuthenticatedCaller) {
    const { sessions, logger, policy } = this.deps;
    if (!sessionId) {
      logger.warn('Sesión sin sessionId — no se aplica control de inactividad', { userId });
      return;
    }
    const session = await sessions.findActiveById(sessionId);
    if (!session) {
      throw new IamUnauthorizedError('Sesión no activa. Inicia sesión nuevamente.', { code: AUTH_ERROR_CODES.SESSION_CLOSED });
    }

    const idle = idleMs(session);
    if (isIdleTooLong(idle, policy.session)) {
      await sessions.close(sessionId, 'inactivity_timeout');
      logger.info('Sesión expirada por inactividad', { userId, sessionId });
      throw new IamUnauthorizedError(
        isInternalRole(roleName)
          ? 'Sesión expirada por inactividad. Vuelve a iniciar sesión con 2FA.'
          : 'Sesión expirada por inactividad. Vuelve a iniciar sesión.',
        { code: AUTH_ERROR_CODES.SESSION_INACTIVITY }
      );
    }
    if (shouldTouch(idle, policy.session)) {
      await sessions.touchLastAccess(sessionId);
    }
  }

  /**
   * ¿El access token fue invalidado? (1) blacklist individual por logout, (2) umbral de su sesión (cerrada o rotada en
   * un refresh), (3) invalidación global por logout-all. Sin Redis se valida contra la base (política A): toda
   * revocación de sesión marca user_sessions.status='closed'.
   */
  // [RF-AUTH-02] | CA-02 | Blacklist en cada request autenticado; fallback a BD si Redis cae
  private async checkTokenBlacklist(accessToken: string, userId: string, tokenIat: number | undefined, sessionId: string | null | undefined) {
    const { revocations, cache, sessions, logger } = this.deps;
    if (!cache.isAvailable()) {
      if (!sessionId) {
        // Sin sessionId no se puede validar contra la base; el token sigue acotado por su expiración
        logger.warn('AuthMiddleware: token sin sessionId — sesión no validada en BD (Redis caído)', { userId });
        return;
      }
      const session = await sessions.findById(sessionId);
      if (!session || session.status !== 'active') {
        logger.warn('AuthMiddleware: acceso denegado — sesión cerrada (fallback BD, Redis caído)', { userId, sessionId });
        throw new SessionClosedError();
      }
      return;
    }

    if (await revocations.isAccessTokenBlacklisted(accessToken)) {
      logger.info('AuthMiddleware: acceso denegado — access token en blacklist', { userId });
      throw new SessionClosedError();
    }
    if (await revocations.isSessionTokenInvalidated(sessionId, tokenIat)) {
      logger.info('AuthMiddleware: acceso denegado — token anterior al umbral de su sesión', { userId, sessionId });
      throw new SessionClosedError();
    }
    if (await revocations.isUserSessionsInvalidated(userId, tokenIat)) {
      logger.info('AuthMiddleware: acceso denegado — sesión invalidada por logout-all', { userId, tokenIat });
      throw new SessionClosedError();
    }
  }

  /** ¿El dispositivo está bloqueado? Sin huella se deja pasar (y se loguea); sin Redis, se consulta la base. */
  private async checkDeviceBlocklist(userId: string, fingerprintHash: string | null | undefined, path: string) {
    const { deviceBlocklist, cache, devices, logger } = this.deps;
    if (!fingerprintHash) {
      logger.warn('AuthMiddleware: fingerprintHash no disponible en res.locals, omitiendo check de blocklist', { userId, path });
      return;
    }
    if (!cache.isAvailable()) {
      const device = await devices.findByFingerprint(userId, fingerprintHash);
      if (device && device.status === 'blocked') {
        logger.warn('AuthMiddleware: acceso denegado — dispositivo bloqueado (fallback BD, Redis caído)', { userId, fingerprintHash, path });
        throw new DeviceBlockedError();
      }
      return;
    }
    if (await deviceBlocklist.isBlocked(userId, fingerprintHash)) {
      logger.warn('AuthMiddleware: acceso denegado — dispositivo bloqueado en Redis', { userId, fingerprintHash, path });
      throw new DeviceBlockedError();
    }
  }
}

// ============================================================
// AUTORIZACIÓN
// ============================================================

/** RF-ADM-01 #6: el usuario con un rol interno puede loguearse sin 2FA, pero no operar (403 MFA_REQUIRED). */
export class RequirePrivilegedMfa {
  constructor(private readonly deps: Pick<IamDeps, 'users' | 'logger'>) {}

  /** ¿El rol exige 2FA y el usuario no lo tiene activo? */
  async isMissing(roleName: string | null | undefined, userId: string | null | undefined): Promise<boolean> {
    if (!roleName || !isInternalRole(roleName)) {
      return false;
    }
    return !(userId ? hasActiveMfa(await this.deps.users.findMfaFlags(userId)) : false);
  }

  async execute(roleName: string | null | undefined, userId: string | null | undefined, path: string): Promise<void> {
    if (await this.isMissing(roleName, userId)) {
      this.deps.logger.info(MFA_NOT_ACTIVE_LOG_MSG, { userId, roleName, path });
      throw new MfaRequiredError();
    }
  }
}

export class AuthorizePermission {
  constructor(private readonly deps: Pick<IamDeps, 'logger'> & { permissions: PermissionResolver; privilegedMfa: RequirePrivilegedMfa }) {}

  /** Exige `action` sobre `moduleName` y, para los roles internos, el 2FA activo. */
  async execute({ roleName, userId, moduleName, action, path }: { roleName: string | null | undefined; userId: string | undefined; moduleName: string; action: string; path: string }) {
    const { permissions, privilegedMfa, logger } = this.deps;
    if (!roleName) {
      // Sin rol no se puede autorizar (authenticate debe haber corrido antes)
      throw new IamUnauthorizedError('Token sin rol asignado');
    }
    if (!(await permissions.can(roleName, moduleName, action))) {
      logger.info('RBAC — acceso denegado', { userId, roleName, module: moduleName, action, path });
      throw new IamForbiddenError('No tienes permisos para realizar esta acción');
    }
    await privilegedMfa.execute(roleName, userId, path);
  }
}

/** La X-API-Key (o el apikey del webhook) de otro sistema. */
export class VerifyExternalApiKey {
  constructor(private readonly deps: Pick<IamDeps, 'apiKeys'>) {}

  execute(apiKey: string | undefined): apiKey is string {
    return this.deps.apiKeys.isValid(apiKey);
  }
}

// ============================================================
// LÍMITE POR IP DEL LOGIN
// ============================================================

const SECONDS_PER_MINUTE = 60;

/**
 * Capa IP del login (RF-AUTH-02 CA-05): si la IP está bloqueada → 429 + Retry-After; cada intento suma al contador
 * y, al superar el límite, la IP queda bloqueada.
 */
export class ThrottleLoginByIp {
  constructor(private readonly deps: Pick<IamDeps, 'rateLimiter' | 'logger'>) {}

  async execute(ip: string): Promise<void> {
    const { rateLimiter, logger } = this.deps;
    const blockedSecs = await rateLimiter.checkIpBlock(ip);
    if (blockedSecs !== null) {
      logger.warn('Rate limit: IP bloqueada en /login', { ip, retryAfter: blockedSecs });
      throw ipBlocked(blockedSecs);
    }
    const newBlockSecs = await rateLimiter.incrementIpAttempts(ip);
    if (newBlockSecs !== null) {
      logger.warn('Rate limit: IP bloqueada tras superar límite en /login', { ip, retryAfter: newBlockSecs });
      throw ipBlocked(newBlockSecs);
    }
  }
}

const ipBlocked = (seconds: number) =>
  new IamRateLimitedError(`Demasiados intentos desde esta IP. Intenta nuevamente en ${Math.ceil(seconds / SECONDS_PER_MINUTE)} minuto(s)`, seconds);
