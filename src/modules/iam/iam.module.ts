// Composición del módulo iam: el ÚNICO archivo del módulo que conoce todas sus capas.
//
//   Prisma (cuentas, roles, sesiones, dispositivos, biometría, resets, intentos) ┐
//   Redis (refresh, blacklist, blocklist, rate limit, caché RBAC)                 ├─► casos de uso ─► controllers ─► routers
//   JWT RS256, bcrypt, TOTP, cifrado, firmas ES256 / HMAC                         ┘        │
//                                                                                          ├─► guards: las guardas HTTP de todos
//                                                                                          ├─► directorios: lo que leen los demás módulos
//                                                                                          ├─► reanudaciones de la doble aprobación
//                                                                                          └─► worker de expiración de sesiones
//
// Lo que viene de afuera (la persona de person, consentimientos y política de legal, códigos OTP / SMS / push /
// preferencias de notification, catálogos, bitácora e intentos de audit, doble aprobación de approvals, avisos,
// logger, transacciones, la política de seguridad) llega por parámetro desde src/main/. iam no importa ningún
// otro módulo.
import type { Router } from 'express';
import type { AuditTrail } from '../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../shared/application/ports/logger.port';
import type { EmailNotifier, Notifier } from '../../shared/application/ports/notifier.port';
import type { UnitOfWork } from '../../shared/application/ports/unit-of-work.port';
import type { IamDeps, IamPolicy } from './application/use-cases/iam-deps';
import type { AccountAnonymizer, AccountHolders, IdentityChecks, TemporaryPasswords } from './application/ports/account-holders.port';
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
} from './application/ports/module-sources.port';
import type { ErrorPolicy } from './application/ports/security.port';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user.repository';
import { PrismaRoleRepository } from './infrastructure/persistence/prisma-role.repository';
import { PrismaRolePermissionOverrideRepository } from './infrastructure/persistence/prisma-role-permission-override.repository';
import { PrismaUserSessionRepository } from './infrastructure/persistence/prisma-user-session.repository';
import { PrismaTrustedDeviceRepository } from './infrastructure/persistence/prisma-trusted-device.repository';
import { PrismaBiometricChallengeRepository, PrismaBiometricCredentialRepository } from './infrastructure/persistence/prisma-biometric.repositories';
import { PrismaCredentialResetRepository } from './infrastructure/persistence/prisma-credential-reset.repository';
import { PrismaLoginAttemptRepository } from './infrastructure/persistence/prisma-login-attempt.repository';
import RedisRefreshTokenStore from './infrastructure/security/redis-refresh-token.store';
import RedisTokenRevocations from './infrastructure/security/redis-token-revocations';
import RedisDeviceBlocklist from './infrastructure/security/redis-device-blocklist';
import RedisLoginRateLimiter from './infrastructure/security/redis-login-rate-limiter';
import {
  bcryptPasswordHasher,
  cryptoRandomSource,
  envApiKeyVerifier,
  es256SignatureVerifier,
  hmacRequestSigner,
  jwtTokenService,
  redisAvailability,
  redisPermissionOverrideCache,
  requestOperationSession,
  secretCipher,
  totpService,
  userAgentDeviceDescriber
} from './infrastructure/security/security.adapters';
import { createSessionExpirationWorker, type SessionExpirationWorker } from './infrastructure/workers/session-expiration.worker';
import { SessionControl, SessionIssuer } from './application/use-cases/sessions';
import { LoginDeviceResolver, LoginPolicyGate, SmsLoginChallenge } from './application/use-cases/login-steps';
import { Login, VerifyMfaLogin } from './application/use-cases/login.use-cases';
import { CloseOtherSessions, CloseOwnSession, Logout, LogoutAll, RefreshTokens } from './application/use-cases/session-lifecycle.use-cases';
import {
  ApproveDevice,
  BlockDevice,
  ListPendingDevices,
  ListTrustedDevices,
  RenameDevice,
  UnblockDevice
} from './application/use-cases/trusted-devices.use-cases';
import { ConfirmCredentialReset, RegisterClient, RequestCredentialReset } from './application/use-cases/registration.use-cases';
import {
  DeleteBiometricCredential,
  FinishBiometricLogin,
  FinishBiometricRegistration,
  ListBiometricCredentials,
  StartBiometricLogin,
  StartBiometricRegistration
} from './application/use-cases/biometric.use-cases';
import {
  ActivateTotp,
  ConfirmSmsMfaActivation,
  DeactivateSmsMfa,
  DeactivateTotp,
  GetMfaStatus,
  MfaAccount,
  RequestSmsMfaActivation,
  SetupTotp,
  UpdatePreferredMfaMethod,
  ValidateMfaPassword,
  VerifyTotp
} from './application/use-cases/mfa.use-cases';
import {
  ExpireSessions,
  ListAuthAttempts,
  ListSessions,
  ListUserAuthAttempts,
  ListUserSessions,
  RevokeSession
} from './application/use-cases/admin-sessions.use-cases';
import {
  ChangeInternalRole,
  CloseInternalUserSessions,
  CreateInternalUser,
  DeleteInternalUser,
  ExecuteInternalRoleChange,
  ExecuteInternalUserDeletion,
  GetInternalUser,
  InternalUserGuards,
  ListDeletedInternalUsers,
  ListInternalRoleOptions,
  ListInternalUserChangeLogs,
  ListInternalUsers,
  ListInternalUserSessions,
  SetInternalUserStatus,
  UpdateInternalUser
} from './application/use-cases/internal-users.use-cases';
import {
  GetEffectivePermissions,
  GetRbacCatalog,
  GetRoleMatrix,
  GrantPermission,
  ListPermissionOverrides,
  PermissionResolver,
  RevokePermission
} from './application/use-cases/rbac.use-cases';
import {
  AuthenticateRequest,
  AuthorizePermission,
  RequirePrivilegedMfa,
  ThrottleLoginByIp,
  VerifyExternalApiKey,
  VerifyRequestSignature
} from './application/use-cases/authentication.use-cases';
import { AccountDirectory, RoleDirectory, SessionDirectory } from './application/use-cases/directories';
import { AuthGuards } from './presentation/http/auth.guards';
import { createAuthCookies, type AuthCookies } from './presentation/http/auth-cookies';
import { AuthBiometricController, AuthLoginController, AuthRegisterController, MfaController } from './presentation/http/auth.controllers';
import { AdminAuthSessionController, AdminRbacController, AdminUserController } from './presentation/http/admin.controllers';
import { createAuthLoginRouter } from './presentation/http/auth-login.routes';
import { createMfaRouter } from './presentation/http/mfa.routes';
import { createAuthRegisterRouter } from './presentation/http/auth-register.routes';
import { createAuthBiometricRouter } from './presentation/http/auth-biometric.routes';
import { createAdminAuthSessionRouter } from './presentation/http/admin-auth-session.routes';
import { createAdminUserRouter } from './presentation/http/admin-user.routes';
import { createAdminRbacRouter } from './presentation/http/admin-rbac.routes';

export interface IamModuleDeps {
  policy: IamPolicy;
  audit: AuditTrail;
  logger: Logger;
  notifier: Notifier & EmailNotifier;
  unitOfWork: UnitOfWork;
  /** Qué errores inesperados se re-lanzan tal cual (los que ya dicen qué responder y los temporales de la base). */
  errors: ErrorPolicy;
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

export interface IamModule {
  /** Login, sesión y dispositivos (admin y client, bajo /api/v1/auth). */
  authRouter: Router;
  /** MFA (admin y client, bajo /api/v1/kyc). */
  mfaRouter: Router;
  /** Registro y reset de credenciales (client, bajo /api/v1/auth). */
  registerRouter: Router;
  /** Biometría (client, bajo /api/v1/auth). */
  biometricRouter: Router;
  /** Sesiones e intentos (admin, bajo /api/v1/auth). */
  adminSessionRouter: Router;
  /** Usuarios internos (admin, bajo /api/v1/kyc). */
  adminUserRouter: Router;
  /** RBAC (admin, bajo /api/v1/kyc). */
  adminRbacRouter: Router;
  /** Las guardas HTTP que usan las rutas de todos los módulos. */
  guards: AuthGuards;
  /** Lo que leen los demás módulos. */
  directories: { accounts: AccountDirectory; roles: RoleDirectory; sessions: SessionDirectory };
  useCases: {
    /** Las reanudaciones de la doble aprobación (RBAC_ROLE_CHANGE, INTERNAL_USER_DELETE). */
    executeRoleChange: ExecuteInternalRoleChange;
    executeUserDeletion: ExecuteInternalUserDeletion;
  };
  /** Cierra las sesiones vencidas (src/main/server.ts lo inicia). */
  sessionExpirationWorker: SessionExpirationWorker;
}

/** Los adaptadores propios de iam (persistencia, Redis, seguridad) junto a lo que llega de afuera. */
function createDeps(external: IamModuleDeps): IamDeps {
  return {
    ...external,
    users: new PrismaUserRepository(),
    roles: new PrismaRoleRepository(),
    overrides: new PrismaRolePermissionOverrideRepository(),
    overrideCache: redisPermissionOverrideCache,
    sessions: new PrismaUserSessionRepository(),
    devices: new PrismaTrustedDeviceRepository(),
    biometricCredentials: new PrismaBiometricCredentialRepository(),
    biometricChallenges: new PrismaBiometricChallengeRepository(),
    credentialResets: new PrismaCredentialResetRepository(),
    loginAttempts: new PrismaLoginAttemptRepository(),
    tokens: jwtTokenService,
    refreshTokens: RedisRefreshTokenStore,
    revocations: RedisTokenRevocations,
    deviceBlocklist: RedisDeviceBlocklist,
    cache: redisAvailability,
    rateLimiter: RedisLoginRateLimiter,
    passwords: bcryptPasswordHasher,
    totp: totpService,
    cipher: secretCipher,
    random: cryptoRandomSource,
    signatures: es256SignatureVerifier,
    deviceDescriber: userAgentDeviceDescriber,
    requestSigner: hmacRequestSigner,
    apiKeys: envApiKeyVerifier,
    operationSession: requestOperationSession
  };
}

/** Las piezas que comparten varios casos de uso. */
function createSteps(deps: IamDeps) {
  return {
    sessionIssuer: new SessionIssuer(deps),
    sessionControl: new SessionControl(deps),
    policyGate: new LoginPolicyGate(deps),
    loginDevices: new LoginDeviceResolver(deps),
    smsChallenge: new SmsLoginChallenge(deps),
    permissions: new PermissionResolver(deps),
    privilegedMfa: new RequirePrivilegedMfa(deps),
    mfaAccount: new MfaAccount(deps),
    internalGuards: new InternalUserGuards(deps)
  };
}

type Steps = ReturnType<typeof createSteps>;

function createGuards(deps: IamDeps, { permissions, privilegedMfa }: Steps) {
  return new AuthGuards(
    {
      authenticate: new AuthenticateRequest({ ...deps, verifySignature: new VerifyRequestSignature(deps) }),
      privilegedMfa,
      authorize: new AuthorizePermission({ ...deps, permissions, privilegedMfa }),
      externalApiKey: new VerifyExternalApiKey(deps),
      throttleLoginIp: new ThrottleLoginByIp(deps)
    },
    deps.logger
  );
}

/** Login, sesión y dispositivos del propio usuario. */
function createAuthLoginController(deps: IamDeps, steps: Steps, cookies: AuthCookies) {
  const { sessionIssuer, sessionControl, policyGate, loginDevices, smsChallenge } = steps;
  const loginDeps = { ...deps, policyGate, loginDevices, smsChallenge, sessionControl, sessionIssuer };
  return new AuthLoginController(
    {
      login: new Login(loginDeps),
      verifyMfa: new VerifyMfaLogin(loginDeps),
      refresh: new RefreshTokens(deps),
      logout: new Logout(deps),
      logoutAll: new LogoutAll(deps),
      closeSession: new CloseOwnSession(sessionControl),
      closeOtherSessions: new CloseOtherSessions(sessionControl),
      listDevices: new ListTrustedDevices(deps),
      listPendingDevices: new ListPendingDevices(deps),
      renameDevice: new RenameDevice(deps),
      approveDevice: new ApproveDevice(deps),
      blockDevice: new BlockDevice(deps),
      unblockDevice: new UnblockDevice(deps)
    },
    cookies
  );
}

/** Registro, reset de credenciales, biometría y MFA. */
function createAccountControllers(deps: IamDeps, steps: Steps, cookies: AuthCookies) {
  const { sessionIssuer, sessionControl, policyGate, mfaAccount } = steps;
  const mfaDeps = { ...deps, account: mfaAccount };
  return {
    register: new AuthRegisterController(
      {
        register: new RegisterClient({ ...deps, sessionIssuer }),
        requestReset: new RequestCredentialReset(deps),
        confirmReset: new ConfirmCredentialReset(deps)
      },
      cookies
    ),
    biometric: new AuthBiometricController({
      registerStart: new StartBiometricRegistration(deps),
      registerFinish: new FinishBiometricRegistration(deps),
      loginStart: new StartBiometricLogin(deps),
      loginFinish: new FinishBiometricLogin({ ...deps, policyGate, sessionControl, sessionIssuer }),
      listCredentials: new ListBiometricCredentials(deps),
      deleteCredential: new DeleteBiometricCredential(deps)
    }),
    mfa: new MfaController({
      setupTotp: new SetupTotp(mfaDeps),
      activateTotp: new ActivateTotp(mfaDeps),
      verifyTotp: new VerifyTotp(mfaDeps),
      deactivateTotp: new DeactivateTotp(mfaDeps),
      validatePassword: new ValidateMfaPassword(mfaDeps),
      getStatus: new GetMfaStatus(mfaDeps),
      requestSmsActivation: new RequestSmsMfaActivation(mfaDeps),
      confirmSmsActivation: new ConfirmSmsMfaActivation(mfaDeps),
      deactivateSms: new DeactivateSmsMfa(mfaDeps),
      updatePreferredMethod: new UpdatePreferredMfaMethod(mfaDeps)
    })
  };
}

/** Usuarios internos, con las reanudaciones de la doble aprobación. */
function createInternalUsers(deps: IamDeps, { internalGuards }: Steps) {
  const internalDeps = { ...deps, guards: internalGuards };
  const executeRoleChange = new ExecuteInternalRoleChange(internalDeps);
  const executeUserDeletion = new ExecuteInternalUserDeletion(internalDeps);
  const controller = new AdminUserController({
    list: new ListInternalUsers(internalDeps),
    listDeleted: new ListDeletedInternalUsers(internalDeps),
    listRoleOptions: new ListInternalRoleOptions(internalDeps),
    get: new GetInternalUser(internalDeps),
    create: new CreateInternalUser(internalDeps),
    update: new UpdateInternalUser(internalDeps),
    changeRole: new ChangeInternalRole({ ...internalDeps, executeRoleChange }),
    setStatus: new SetInternalUserStatus(internalDeps),
    delete: new DeleteInternalUser({ ...internalDeps, executeDeletion: executeUserDeletion }),
    listSessions: new ListInternalUserSessions(internalDeps),
    closeSessions: new CloseInternalUserSessions(internalDeps),
    listChangeLogs: new ListInternalUserChangeLogs(internalDeps)
  });
  return { controller, executeRoleChange, executeUserDeletion };
}

/** Sesiones e intentos de autenticación, y RBAC. */
function createAdminControllers(deps: IamDeps, { permissions }: Steps) {
  const rbacDeps = { ...deps, permissions };
  return {
    sessions: new AdminAuthSessionController({
      list: new ListSessions(deps),
      listByUser: new ListUserSessions(deps),
      revoke: new RevokeSession(deps),
      listAttempts: new ListAuthAttempts(deps),
      listAttemptsByUser: new ListUserAuthAttempts(deps)
    }),
    rbac: new AdminRbacController({
      catalog: new GetRbacCatalog(deps),
      matrix: new GetRoleMatrix(rbacDeps),
      effectivePermissions: new GetEffectivePermissions(rbacDeps),
      listOverrides: new ListPermissionOverrides(rbacDeps),
      grant: new GrantPermission(rbacDeps),
      revoke: new RevokePermission(rbacDeps)
    })
  };
}

export function createIamModule(external: IamModuleDeps): IamModule {
  const deps = createDeps(external);
  const steps = createSteps(deps);
  const guards = createGuards(deps, steps);
  const cookies = createAuthCookies(deps.tokens.accessTokenExpiry);
  const account = createAccountControllers(deps, steps, cookies);
  const internalUsers = createInternalUsers(deps, steps);
  const admin = createAdminControllers(deps, steps);

  return {
    authRouter: createAuthLoginRouter(createAuthLoginController(deps, steps, cookies), guards),
    mfaRouter: createMfaRouter(account.mfa, guards),
    registerRouter: createAuthRegisterRouter(account.register),
    biometricRouter: createAuthBiometricRouter(account.biometric, guards),
    adminSessionRouter: createAdminAuthSessionRouter(admin.sessions, guards),
    adminUserRouter: createAdminUserRouter(internalUsers.controller, guards),
    adminRbacRouter: createAdminRbacRouter(admin.rbac, guards),
    guards,
    directories: { accounts: new AccountDirectory(deps), roles: new RoleDirectory(deps), sessions: new SessionDirectory(deps) },
    useCases: { executeRoleChange: internalUsers.executeRoleChange, executeUserDeletion: internalUsers.executeUserDeletion },
    sessionExpirationWorker: createSessionExpirationWorker(new ExpireSessions(deps), deps.logger)
  };
}
