// Las dependencias de los casos de uso de iam: los puertos (que llegan armados desde iam.module.ts) y la política
// de seguridad. Cada caso de uso declara con `Pick<IamDeps, …>` las que usa.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { EmailNotifier, Notifier } from '../../../../shared/application/ports/notifier.port';
import type { UnitOfWork } from '../../../../shared/application/ports/unit-of-work.port';
import type { SessionPolicy } from '../../domain/session';
import type { AccountAnonymizer, AccountHolders, IdentityChecks, TemporaryPasswords } from '../ports/account-holders.port';
import type {
  CacheAvailability,
  DeviceBlocklist,
  LoginRateLimiter,
  RefreshTokenStore,
  TokenRevocations,
  TokenService
} from '../ports/auth-tokens.port';
import type { BiometricChallengeRepository, BiometricCredentialRepository } from '../ports/biometric-repository.port';
import type { CredentialResetRepository, LoginAttemptRepository } from '../ports/credential-reset-repository.port';
import type {
  AccountChangeHistory,
  AccountChangeLog,
  AuthAttemptLog,
  CatalogLookups,
  ConsentRecorder,
  DualApproval,
  NotificationPreferences,
  PrivacyPolicies,
  PushDevices,
  SmsSender,
  VerificationCodes
} from '../ports/module-sources.port';
import type { PermissionOverrideCache, RolePermissionOverrideRepository, RoleRepository } from '../ports/role-repository.port';
import type {
  ApiKeyVerifier,
  DeviceDescriber,
  ErrorPolicy,
  OperationSession,
  PasswordHasher,
  RandomSource,
  RequestSigner,
  SecretCipher,
  SignatureVerifier,
  TotpService
} from '../ports/security.port';
import type { SessionRepository } from '../ports/session-repository.port';
import type { TrustedDeviceRepository } from '../ports/trusted-device-repository.port';
import type { UserRepository } from '../ports/user-repository.port';

/** La política de seguridad (la fija la configuración; los casos de uso no la leen de ningún lado). */
export interface IamPolicy {
  session: SessionPolicy;
  /** Intentos fallidos seguidos que bloquean la cuenta. */
  maxAccountAttempts: number;
  /** Minutos de vida del enlace de reset de credenciales. */
  resetTokenMinutes: number;
  /** Base del enlace de reset del front (se le agrega -password / -totp). */
  resetCredentialUrl: string | undefined;
  /** Con proveedores simulados, los OTP por SMS son siempre 123456. */
  mockOtpCodes: boolean;
  /** En producción, los requests mobile deben venir firmados (HMAC). */
  requireMobileSignature: boolean;
  /** Logo de las plantillas de correo. */
  notificationLogoUrl: string | null | undefined;
}

export interface IamDeps {
  policy: IamPolicy;
  audit: AuditTrail;
  logger: Logger;
  notifier: Notifier & EmailNotifier;
  unitOfWork: UnitOfWork;

  users: UserRepository;
  roles: RoleRepository;
  overrides: RolePermissionOverrideRepository;
  overrideCache: PermissionOverrideCache;
  sessions: SessionRepository;
  devices: TrustedDeviceRepository;
  biometricCredentials: BiometricCredentialRepository;
  biometricChallenges: BiometricChallengeRepository;
  credentialResets: CredentialResetRepository;
  loginAttempts: LoginAttemptRepository;

  tokens: TokenService;
  refreshTokens: RefreshTokenStore;
  revocations: TokenRevocations;
  deviceBlocklist: DeviceBlocklist;
  cache: CacheAvailability;
  rateLimiter: LoginRateLimiter;

  passwords: PasswordHasher;
  totp: TotpService;
  cipher: SecretCipher;
  random: RandomSource;
  signatures: SignatureVerifier;
  deviceDescriber: DeviceDescriber;
  requestSigner: RequestSigner;
  apiKeys: ApiKeyVerifier;
  errors: ErrorPolicy;
  operationSession: OperationSession;

  holders: AccountHolders;
  identity: IdentityChecks;
  anonymizer: AccountAnonymizer;
  temporaryPasswords: TemporaryPasswords;
  privacyPolicies: PrivacyPolicies;
  consents: ConsentRecorder;
  verificationCodes: VerificationCodes;
  sms: SmsSender;
  pushDevices: PushDevices;
  preferences: NotificationPreferences;
  catalogs: CatalogLookups;
  changeLog: AccountChangeLog;
  authAttempts: AuthAttemptLog;
  changeHistory: AccountChangeHistory;
  approvals: DualApproval;
}

/** Un error de un efecto en segundo plano: se loguea y no corta el flujo. */
export const warnOnError =
  (logger: Logger, message: string, meta: Record<string, unknown> = {}) =>
  (err: { message?: string } | undefined) =>
    logger.warn(message, { error: err?.message, ...meta });
