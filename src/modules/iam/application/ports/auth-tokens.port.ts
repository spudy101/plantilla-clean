// Puertos: los tokens propios (RS256) y su revocación.
//
//   TokenService        emite y verifica access, refresh y el reto MFA (una firma inválida o vencida la rechaza
//                       el adaptador con su propio 401)
//   RefreshTokenStore   el JTI vigente de cada refresh (rotación de un solo uso + ventana de gracia)
//   TokenRevocations    blacklist de tokens concretos y umbrales por sesión / por usuario
//   DeviceBlocklist     dispositivos bloqueados (invalidación inmediata del access token)
//   CacheAvailability   ¿está Redis? (sin él se valida contra la base: política A)
import type { LoginUser, RoleRef, UserAccount } from '../../domain/user';

/** Lo que necesita el access token del usuario (rol y persona cargados). */
export type TokenUser = Pick<UserAccount, 'userId' | 'personId' | 'roleId' | 'authUsername'> & {
  role?: Pick<RoleRef, 'name'> | null;
  person?: LoginUser['person'] | null;
};

export interface AccessClaims {
  sessionId?: string | null;
  userId?: string;
  personId?: string | null;
  roleId?: string | null;
  roleName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  nationalId?: string | null;
  authUsername?: string | null;
  email?: string | null;
  iat?: number;
  exp?: number;
}

export interface RefreshClaims {
  userId: string;
  jti: string;
  sessionId: string | null;
  iat?: number;
}

/** Par de tokens emitido (se devuelve igual dentro de la ventana de gracia de la rotación). */
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface TokenService {
  /** Segundos de vida del access token. */
  readonly accessTokenExpiry: number;
  generateAccessToken(user: TokenUser, sessionId: string | null): Promise<string>;
  generateRefreshToken(userId: string, jti: string, sessionId: string | null): Promise<string>;
  verifyAccessToken(token: string): Promise<AccessClaims>;
  verifyRefreshToken(token: string): Promise<RefreshClaims>;
  /** El reto MFA prueba que la contraseña ya pasó el paso 1 (5 minutos). */
  generateMfaChallengeToken(userId: string): Promise<string>;
  verifyMfaChallengeToken(token: string): Promise<{ userId?: unknown }>;
}

export interface RefreshTokenStore {
  /** false si no se pudo guardar (el refresh nuevo no servirá). */
  save(jti: string, userId: string): Promise<boolean>;
  revoke(jti: string): Promise<void>;
  /** El usuario del JTI; null si no está (o si Redis no está disponible). */
  exists(jti: string): Promise<string | null>;
  /** El par emitido al rotar `oldJti`, durante la ventana de gracia. */
  saveRotation(oldJti: string, tokens: IssuedTokens): Promise<boolean>;
  getRotation(oldJti: string): Promise<IssuedTokens | null>;
}

export interface TokenRevocations {
  blacklistAccessToken(accessToken: string | null | undefined, tokenExp?: number | null): Promise<unknown>;
  blacklistRefreshToken(refreshToken: string): Promise<unknown>;
  /** Invalida el access token vigente de la sesión. */
  blacklistSession(sessionId: string): Promise<unknown>;
  /** Tras rotar: el access anterior de la sesión deja de servir (con la gracia diferida). */
  invalidateSessionTokensOnRotation(sessionId: string, rotationTs: number): Promise<unknown>;
  /** logout-all / reuse attack: todo token del usuario emitido hasta ahora deja de servir. */
  invalidateUserSessions(userId: string): Promise<unknown>;
  clearUserInvalidation(userId: string): Promise<unknown>;
  isAccessTokenBlacklisted(accessToken: string): Promise<boolean>;
  isRefreshTokenBlacklisted(refreshToken: string): Promise<boolean>;
  isSessionTokenInvalidated(sessionId: string | null | undefined, tokenIat: number | undefined): Promise<boolean>;
  isUserSessionsInvalidated(userId: string, tokenIat: number | undefined): Promise<boolean>;
}

export interface DeviceBlocklist {
  block(userId: string, fingerprintHash: string): Promise<boolean>;
  unblock(userId: string, fingerprintHash: string): Promise<boolean>;
  isBlocked(userId: string, fingerprintHash: string): Promise<boolean>;
}

export interface CacheAvailability {
  isAvailable(): boolean;
}

/** Los contadores de intentos de login (por IP y por cuenta). Devuelven los segundos de bloqueo, o null. */
export interface LoginRateLimiter {
  checkIpBlock(ip: string): Promise<number | null>;
  incrementIpAttempts(ip: string): Promise<number | null>;
  checkAccountBlock(nationalId: string): Promise<number | null>;
  incrementAccountFailures(nationalId: string): Promise<number | null>;
  resetAccountCounters(nationalId: string): Promise<unknown>;
}
