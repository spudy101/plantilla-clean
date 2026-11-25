// tests/doubles/iam.doubles.ts
//
// Dobles en memoria de los puertos de iam, para los tests de los casos de uso (sin jest.mock, sin Prisma, sin Redis),
// y fábricas de entidades de ejemplo. `iamWorld()` arma todas las dependencias (IamDeps) con estos dobles: cada test
// toma las que usa, configura lo que necesita y mira qué quedó guardado, auditado, revocado o notificado.
import type { PageRequest } from '../../src/shared/application/pagination';
import type { AuditEntry, AuditTrail } from '../../src/shared/application/ports/audit-trail.port';
import type { Logger, LogMeta } from '../../src/shared/application/ports/logger.port';
import type { UnitOfWork } from '../../src/shared/application/ports/unit-of-work.port';
import { DomainError } from '../../src/shared/domain/errors/domain-error';
import type { IamDeps, IamPolicy } from '../../src/modules/iam/application/use-cases/iam-deps';
import type {
  AccountAnonymizer,
  AccountHolders,
  CreatedAccountHolder,
  IdentityChecks,
  NewAccountHolder,
  TemporaryPasswords
} from '../../src/modules/iam/application/ports/account-holders.port';
import type {
  AccessClaims,
  CacheAvailability,
  DeviceBlocklist,
  IssuedTokens,
  LoginRateLimiter,
  RefreshClaims,
  RefreshTokenStore,
  TokenRevocations,
  TokenService,
  TokenUser
} from '../../src/modules/iam/application/ports/auth-tokens.port';
import type { BiometricChallengeRepository, BiometricCredentialRepository } from '../../src/modules/iam/application/ports/biometric-repository.port';
import type { CredentialResetRepository, LoginAttemptRepository } from '../../src/modules/iam/application/ports/credential-reset-repository.port';
import type {
  AccountChange,
  AccountChangeHistory,
  AccountChangeLog,
  AccountChangeRecord,
  AuthAttempt,
  AuthAttemptCriteria,
  AuthAttemptLog,
  CatalogLookups,
  ConsentRecorder,
  ContactKind,
  DocumentTypeEntry,
  DualApproval,
  NotificationPreferences,
  PrivacyPolicies,
  PushDevices,
  SmsSender,
  VerificationCodes
} from '../../src/modules/iam/application/ports/module-sources.port';
import type {
  PermissionOverrideCache,
  Role,
  RolePermissionOverrideRepository,
  RoleRepository
} from '../../src/modules/iam/application/ports/role-repository.port';
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
} from '../../src/modules/iam/application/ports/security.port';
import type { NewSession, SessionRepository } from '../../src/modules/iam/application/ports/session-repository.port';
import type { TrustedDeviceRepository } from '../../src/modules/iam/application/ports/trusted-device-repository.port';
import type { NewUserAccount, UserListFilters, UserRepository } from '../../src/modules/iam/application/ports/user-repository.port';
import { SessionControl, SessionIssuer } from '../../src/modules/iam/application/use-cases/sessions';
import { LoginDeviceResolver, LoginPolicyGate, SmsLoginChallenge } from '../../src/modules/iam/application/use-cases/login-steps';
import { IamConflictError, IamUnauthorizedError } from '../../src/modules/iam/domain/errors';
import type { BiometricChallenge, BiometricCredential, ChallengeType } from '../../src/modules/iam/domain/biometric';
import type { CredentialResetWithUser, ResetType } from '../../src/modules/iam/domain/credential-reset';
import type { AccountBlock, LoginAttempt } from '../../src/modules/iam/domain/login-attempt';
import type { ActivePolicy } from '../../src/modules/iam/domain/login';
import type { OtpCode } from '../../src/modules/iam/domain/mfa';
import type { PermissionOverride, RolePermissionOverride } from '../../src/modules/iam/domain/rbac';
import type { SessionFilters, UserSession } from '../../src/modules/iam/domain/session';
import type { DeviceDescription, NewTrustedDevice, TrustedDevice } from '../../src/modules/iam/domain/trusted-device';
import type { PersonProfileRef, UserChanges, UserProfile } from '../../src/modules/iam/domain/user';
import { RecordingNotices } from './person.doubles';

export { RecordingNotices };

const AT = new Date('2026-01-01T00:00:00Z');

// ── Fixtures ───────────────────────────────────────────────────
export const role = (roleId: string, name: string): Role => ({
  roleId,
  name,
  description: `Rol ${name}`,
  isActive: true,
  createdAt: AT,
  updatedAt: AT
});

export const ROLES = {
  SUPERADMIN: role('role-super', 'SUPERADMIN'),
  ADMIN: role('role-admin', 'ADMIN'),
  AUDITOR: role('role-auditor', 'AUDITOR'),
  CLIENTE: role('role-cliente', 'CLIENTE')
};

export const CLIENT_ID = 'u-cliente';
export const STAFF_ID = 'u-staff';
export const ADMIN_ID = 'u-admin';
export const SUPER_ID = 'u-super';
export const CLIENT_DOC = '1020304050';

export const ADMIN_CTX = { adminUserId: ADMIN_ID, adminRoleName: 'ADMIN', adminFirstName: 'Admin', ipAddress: '10.0.0.1', userAgent: 'jest' };

export const person = (over: Partial<PersonProfileRef> = {}): PersonProfileRef => {
  const personId = over.personId ?? 'p-ana';
  return {
    personId,
    firstName: 'Ana',
    middleName: null,
    lastName: 'Pérez',
    secondLastName: null,
    nationalId: CLIENT_DOC,
    birthDate: null,
    genderId: null,
    countryId: 'co',
    documentTypeId: 'dt-cc',
    createdAt: AT,
    updatedAt: AT,
    contact: {
      personContactId: `pc-${personId}`,
      personId,
      email: 'ana@correo.co',
      emailVerifiedAt: AT,
      phonePrimary: '3001234567',
      phonePrimaryPrefixId: 'pp-57',
      phonePrimaryVerifiedAt: AT,
      phoneSecondary: null,
      phoneSecondaryPrefixId: null,
      phoneSecondaryVerifiedAt: null,
      createdAt: AT,
      updatedAt: AT,
      phonePrimaryPrefix: { prefix: '+57' },
      phoneSecondaryPrefix: null
    },
    gender: null,
    country: null,
    documentType: null,
    location: null,
    ...over
  };
};

/** Una cuenta con su perfil completo. Por defecto: un cliente activo sin MFA, con la política 1.0 aceptada. */
export const user = (over: Partial<UserProfile> = {}): UserProfile => ({
  userId: CLIENT_ID,
  username: 'user_ana',
  passwordHash: 'hash:Correcta#2026',
  authUsername: 'user_ana',
  personId: 'p-ana',
  roleId: ROLES.CLIENTE.roleId,
  avatarId: null,
  totpEnabled: false,
  totpSecret: null,
  smsMfaEnabled: false,
  preferredMfaMethod: 'none',
  privacyPolicyVersion: '1.0',
  privacyPolicyAcceptedAt: AT,
  privacyPolicyAcceptedIp: '1.1.1.1',
  isActive: true,
  deletedAt: null,
  createdAt: AT,
  updatedAt: AT,
  role: ROLES.CLIENTE,
  person: person(),
  avatar: null,
  ...over
});

/** Un usuario interno (AUDITOR por defecto). */
export const staff = (over: Partial<UserProfile> = {}): UserProfile =>
  user({
    userId: STAFF_ID,
    username: 'staff_laura',
    authUsername: 'staff_laura',
    personId: 'p-laura',
    roleId: ROLES.AUDITOR.roleId,
    role: ROLES.AUDITOR,
    person: person({ personId: 'p-laura', firstName: 'Laura', lastName: 'Gómez', nationalId: 'LAURA0001' }),
    ...over
  });

export const admin = (over: Partial<UserProfile> = {}): UserProfile =>
  staff({
    userId: ADMIN_ID,
    username: 'staff_admin',
    authUsername: 'staff_admin',
    personId: 'p-admin',
    roleId: ROLES.ADMIN.roleId,
    role: ROLES.ADMIN,
    passwordHash: 'hash:Admin#2026',
    totpEnabled: true,
    person: person({ personId: 'p-admin', firstName: 'Admin', lastName: 'Dos', nationalId: 'ADMIN0001' }),
    ...over
  });

export const superadmin = (over: Partial<UserProfile> = {}): UserProfile =>
  staff({
    userId: SUPER_ID,
    username: 'staff_super',
    authUsername: 'staff_super',
    personId: 'p-super',
    roleId: ROLES.SUPERADMIN.roleId,
    role: ROLES.SUPERADMIN,
    totpEnabled: true,
    person: person({ personId: 'p-super', firstName: 'Super', lastName: 'Admin', nationalId: 'SUPER0001' }),
    ...over
  });

export const session = (over: Partial<UserSession> = {}): UserSession => ({
  userSessionId: 's-1',
  userId: CLIENT_ID,
  deviceId: 'dev-1',
  jti: 'jti-1',
  ipAddress: '1.1.1.1',
  userAgent: 'jest',
  status: 'active',
  startedAt: new Date(),
  lastAccessAt: new Date(),
  closedAt: null,
  closeReason: null,
  createdAt: AT,
  updatedAt: AT,
  ...over
});

export const device = (over: Partial<TrustedDevice> = {}): TrustedDevice => ({
  userTrustedDeviceId: 'dev-1',
  userId: CLIENT_ID,
  fingerprintHash: 'fp-1',
  deviceName: 'Chrome en Windows',
  status: 'trusted',
  ipAddress: '1.1.1.1',
  city: null,
  country: null,
  countryCode: null,
  browser: 'Chrome',
  os: 'Windows',
  deviceType: 'desktop',
  hmacSecret: 'hmac-dev-1',
  approvedByDeviceId: null,
  approvedAt: null,
  blockedByDeviceId: null,
  blockedAt: null,
  trustedAt: AT,
  lastSeenAt: AT,
  originSessionId: null,
  createdAt: AT,
  updatedAt: AT,
  ...over
});

export const credential = (over: Partial<BiometricCredential> = {}): BiometricCredential => ({
  userBiometricCredentialId: 'bio-1',
  userId: CLIENT_ID,
  userTrustedDeviceId: 'dev-1',
  credentialId: 'cred-1',
  publicKey: 'pk-1',
  signCount: 5,
  isActive: true,
  lastUsedAt: null,
  createdAt: AT,
  updatedAt: AT,
  ...over
});

export const ACTIVE_POLICY: ActivePolicy = {
  privacyPolicyId: 'pol-2',
  version: '2.0',
  documentUrl: 'https://cdn.test/politica-2.pdf',
  summary: 'Cambios',
  effectiveDate: AT
};

export const PAGE = { page: 1, limit: 10, sortBy: 'createdAt', order: 'DESC' as const };

const copy = <T extends object>(value: T | undefined): T | null => (value ? { ...value } : null);

// ── Repositorios de iam ────────────────────────────────────────
export class InMemoryUsers implements UserRepository {
  constructor(
    public users: UserProfile[] = [user()],
    /** Las personas que crea InMemoryHolders (el alta de una cuenta las lee de acá). */
    readonly persons = new Map<string, PersonProfileRef>(),
    readonly roles: Role[] = Object.values(ROLES)
  ) {}
  readonly updates: Array<{ userId: string; changes: UserChanges & { passwordHash?: string } }> = [];
  readonly created: NewUserAccount[] = [];
  readonly lists: Array<{ filters: UserListFilters; search: string | null }> = [];

  get(userId: string) {
    return this.users.find(u => u.userId === userId) ?? null;
  }
  private find(userId: string) {
    return copy(this.users.find(u => u.userId === userId));
  }
  async findById(userId: string) {
    return this.find(userId);
  }
  async findByPersonId(personId: string) {
    return copy(this.users.find(u => u.personId === personId));
  }
  async findWithRole(userId: string) {
    return this.find(userId);
  }
  async findLoginUser(userId: string) {
    return this.find(userId);
  }
  async findLoginUserByNationalId(nationalId: string) {
    return copy(this.users.find(u => u.person?.nationalId === nationalId));
  }
  async findLoginUserByUsername(username: string) {
    return copy(this.users.find(u => u.username === username));
  }
  async findProfile(userId: string) {
    return this.find(userId);
  }
  async findWithContact(userId: string) {
    return this.find(userId);
  }
  async findWithPrimaryPhone(userId: string) {
    return this.find(userId);
  }
  async findAdminTarget(userId: string) {
    return this.find(userId);
  }
  async findForAccountDeletion(userId: string) {
    return this.find(userId);
  }
  async findMfaFlags(userId: string) {
    const found = this.get(userId);
    return found ? { totpEnabled: found.totpEnabled, smsMfaEnabled: found.smsMfaEnabled } : null;
  }
  async findActiveIdsByRoleNames(roleNames: readonly string[]) {
    return this.users.filter(u => u.isActive && roleNames.includes(u.role?.name ?? '')).map(u => u.userId);
  }
  async findActivePageByRoleNames(roleNames: readonly string[], afterUserId: string | null, limit: number) {
    return this.users
      .filter(u => u.isActive && roleNames.includes(u.role?.name ?? '') && (!afterUserId || u.userId > afterUserId))
      .sort((a, b) => a.userId.localeCompare(b.userId))
      .slice(0, limit);
  }
  async list(filters: UserListFilters, _page: PageRequest, search: string | null) {
    this.lists.push({ filters, search });
    const rows = this.users
      .filter(u => !filters.roleIds || filters.roleIds.includes(u.roleId))
      .filter(u => !filters.excludeUserId || u.userId !== filters.excludeUserId)
      .filter(u => filters.isActive === undefined || u.isActive === filters.isActive)
      .filter(u => (filters.onlyDeleted ? u.deletedAt !== null : filters.includeDeleted || u.deletedAt === null))
      .map(u => ({ ...u }));
    return { rows, count: rows.length };
  }
  async create(account: NewUserAccount) {
    this.created.push(account);
    const created = user({
      userId: `u-${this.users.length + 1}`,
      username: account.username,
      authUsername: account.authUsername ?? null,
      passwordHash: account.passwordHash,
      personId: account.personId,
      roleId: account.roleId,
      privacyPolicyVersion: account.privacyPolicyVersion ?? null,
      privacyPolicyAcceptedAt: account.privacyPolicyAcceptedAt ?? null,
      privacyPolicyAcceptedIp: account.privacyPolicyAcceptedIp ?? null,
      role: this.roles.find(r => r.roleId === account.roleId) ?? null,
      person: this.persons.get(account.personId) ?? null
    });
    this.users.push(created);
    return { ...created };
  }
  async update(userId: string, changes: UserChanges & { passwordHash?: string; avatarId?: string }) {
    this.updates.push({ userId, changes });
    const found = this.get(userId);
    if (!found) {
      return null;
    }
    Object.assign(found, changes);
    if (changes.roleId) {
      found.role = this.roles.find(r => r.roleId === changes.roleId) ?? null;
    }
    return { ...found };
  }
}

export class InMemoryRoles implements RoleRepository {
  constructor(public roles: Role[] = Object.values(ROLES)) {}
  readonly lists: unknown[] = [];

  async list(filters: { isActive?: boolean } & Record<string, unknown>, _page: PageRequest, search: string | null) {
    this.lists.push({ filters, search });
    return { rows: this.roles, count: this.roles.length };
  }
  async findById(roleId: string) {
    return this.roles.find(r => r.roleId === roleId) ?? null;
  }
  async findByName(name: string) {
    return this.roles.find(r => r.name === name) ?? null;
  }
  async findByNames(names: readonly string[], options: { exclude?: readonly string[] } = {}) {
    return this.roles.filter(r => names.includes(r.name) && !(options.exclude ?? []).includes(r.name));
  }
}

export class InMemoryOverrides implements RolePermissionOverrideRepository {
  constructor(public overrides: RolePermissionOverride[] = []) {}
  readonly lookups: string[] = [];

  async findById(id: string) {
    return this.overrides.find(o => o.rolePermissionOverrideId === id) ?? null;
  }
  async create(override: PermissionOverride & { roleName: string; grantedByUserId: string }) {
    const created = { ...override, rolePermissionOverrideId: `ovr-${this.overrides.length + 1}`, createdAt: AT };
    this.overrides.push(created);
    return created;
  }
  async findByRole(roleName: string) {
    return this.overrides.filter(o => o.roleName === roleName);
  }
  async deleteById(id: string) {
    const before = this.overrides.length;
    this.overrides = this.overrides.filter(o => o.rolePermissionOverrideId !== id);
    return this.overrides.length < before;
  }
  async exists(roleName: string, moduleName: string, action: string) {
    return this.overrides.some(o => o.roleName === roleName && o.moduleName === moduleName && o.action === action);
  }
  async findLookupByRole(roleName: string) {
    this.lookups.push(roleName);
    return this.overrides.filter(o => o.roleName === roleName).map(({ moduleName, action }) => ({ moduleName, action }));
  }
}

export class InMemoryOverrideCache implements PermissionOverrideCache {
  readonly entries = new Map<string, PermissionOverride[]>();
  readonly invalidated: string[] = [];
  async get(roleName: string) {
    return this.entries.get(roleName) ?? null;
  }
  async set(roleName: string, overrides: PermissionOverride[]) {
    this.entries.set(roleName, overrides);
  }
  async invalidate(roleName: string) {
    this.invalidated.push(roleName);
    this.entries.delete(roleName);
  }
}

export class InMemorySessions implements SessionRepository {
  constructor(public sessions: UserSession[] = []) {}
  readonly closes: Array<{ sessionId: string; reason: string }> = [];
  readonly bulkCloses: Array<{ userId: string; except?: string | null; reason: string }> = [];
  readonly touched: string[] = [];
  readonly rotated: Array<{ sessionId: string; jti: string }> = [];
  readonly listed: SessionFilters[] = [];

  get(sessionId: string) {
    return this.sessions.find(s => s.userSessionId === sessionId) ?? null;
  }
  private active(userId: string) {
    return this.sessions.filter(s => s.userId === userId && s.status === 'active');
  }
  private closeOne(s: UserSession, reason: string) {
    s.status = 'closed';
    s.closeReason = reason;
    s.closedAt = new Date();
  }
  async create(data: NewSession) {
    const created = session({ ...data, status: 'active' });
    this.sessions.push(created);
    return created;
  }
  async findById(sessionId: string) {
    return copy(this.get(sessionId) ?? undefined);
  }
  async findActiveById(sessionId: string) {
    const found = this.get(sessionId);
    return found?.status === 'active' ? { ...found } : null;
  }
  async findActiveByUser(userId: string) {
    return this.active(userId);
  }
  async findActiveByUserExcept(userId: string, exceptSessionId: string | null) {
    return this.active(userId).filter(s => s.userSessionId !== exceptSessionId);
  }
  async findActiveByUserAndDevice(userId: string, deviceId: string) {
    return this.active(userId).filter(s => s.deviceId === deviceId);
  }
  async findOldestActive(userId: string) {
    return [...this.active(userId)].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())[0] ?? null;
  }
  async countActive(userId: string) {
    return this.active(userId).length;
  }
  async findClosable(inactivityCutoff: Date, absoluteCutoff: Date) {
    return this.sessions.filter(s => s.status === 'active' && (s.lastAccessAt < inactivityCutoff || s.startedAt < absoluteCutoff));
  }
  async findDevicesOfOwnSessions(sessionIds: string[], userId: string) {
    return this.sessions
      .filter(s => sessionIds.includes(s.userSessionId) && s.userId === userId)
      .map(s => ({ userSessionId: s.userSessionId, device: s.deviceId ? { userTrustedDeviceId: s.deviceId, deviceName: 'Equipo' } : null }));
  }
  async findPaginatedWithDeviceAndUser(filters: SessionFilters, _page: PageRequest) {
    this.listed.push(filters);
    const rows = this.sessions
      .filter(s => !filters.userId || s.userId === filters.userId)
      .filter(s => !filters.status || s.status === filters.status)
      .map(s => ({ ...s, device: null, sessionUser: null }));
    return { rows, count: rows.length };
  }
  async findByIdWithDeviceAndUser(sessionId: string) {
    const found = this.get(sessionId);
    return found ? { ...found, device: null, sessionUser: null } : null;
  }
  async touchLastAccess(sessionId: string) {
    this.touched.push(sessionId);
    return 1;
  }
  async updateJtiAndLastAccess(sessionId: string, jti: string) {
    this.rotated.push({ sessionId, jti });
    return 1;
  }
  async close(sessionId: string, reason: string): Promise<number> {
    this.closes.push({ sessionId, reason });
    const found = this.get(sessionId);
    if (!found || found.status !== 'active') {
      return 0;
    }
    this.closeOne(found, reason);
    return 1;
  }
  async closeAllByUser(userId: string, reason: string) {
    this.bulkCloses.push({ userId, reason });
    const actives = this.active(userId);
    actives.forEach(s => this.closeOne(s, reason));
    return actives.length;
  }
  async closeAllByUserExcept(userId: string, exceptSessionId: string | null, reason: string) {
    this.bulkCloses.push({ userId, except: exceptSessionId, reason });
    const others = await this.findActiveByUserExcept(userId, exceptSessionId);
    others.forEach(s => this.closeOne(s, reason));
    return others.length;
  }
}

export class InMemoryDevices implements TrustedDeviceRepository {
  constructor(public devices: TrustedDevice[] = [device()]) {}
  readonly created: NewTrustedDevice[] = [];
  readonly seen: Array<{ userId: string; fingerprintHash: string }> = [];
  readonly deletedFor: string[] = [];

  get(deviceId: string) {
    return this.devices.find(d => d.userTrustedDeviceId === deviceId) ?? null;
  }
  private change(deviceId: string, changes: Partial<TrustedDevice>) {
    const found = this.get(deviceId);
    if (!found) {
      throw new Error(`dispositivo ${deviceId} inexistente`);
    }
    Object.assign(found, changes, { updatedAt: new Date() });
    return { ...found };
  }
  async findById(deviceId: string) {
    return copy(this.get(deviceId) ?? undefined);
  }
  async findByFingerprint(userId: string, fingerprintHash: string) {
    return copy(this.devices.find(d => d.userId === userId && d.fingerprintHash === fingerprintHash));
  }
  async findAnyByFingerprint(fingerprintHash: string) {
    return copy(this.devices.find(d => d.fingerprintHash === fingerprintHash));
  }
  async findByIdAndUser(deviceId: string, userId: string) {
    return copy(this.devices.find(d => d.userTrustedDeviceId === deviceId && d.userId === userId));
  }
  async findByIds(ids: readonly string[]) {
    return this.devices.filter(d => ids.includes(d.userTrustedDeviceId));
  }
  async findAllByUserWithSessions(userId: string) {
    return this.devices.filter(d => d.userId === userId).map(d => ({ ...d, sessions: [] }));
  }
  async findAllPending(userId: string) {
    return this.devices.filter(d => d.userId === userId && d.status === 'pending');
  }
  async countTrusted(userId: string) {
    return this.devices.filter(d => d.userId === userId && d.status === 'trusted').length;
  }
  async create(data: NewTrustedDevice) {
    this.created.push(data);
    const n = this.devices.length + 1;
    const created = device({
      ...data,
      userTrustedDeviceId: `dev-${n}`,
      hmacSecret: `hmac-dev-${n}`,
      deviceType: data.deviceType ?? 'desktop',
      browser: data.browser ?? null,
      os: data.os ?? null,
      city: data.city ?? null,
      country: data.country ?? null,
      countryCode: data.countryCode ?? null,
      trustedAt: data.trustedAt ?? null
    });
    this.devices.push(created);
    return { ...created };
  }
  async approve(deviceId: string, approvedByDeviceId: string) {
    return this.change(deviceId, { status: 'trusted', approvedByDeviceId, approvedAt: new Date() });
  }
  async block(deviceId: string, blockedByDeviceId: string) {
    return this.change(deviceId, { status: 'blocked', blockedByDeviceId, blockedAt: new Date() });
  }
  async unblock(deviceId: string) {
    return this.change(deviceId, { status: 'pending', blockedByDeviceId: null, blockedAt: null });
  }
  async rename(deviceId: string, deviceName: string) {
    return this.change(deviceId, { deviceName });
  }
  async updateLastSeen(userId: string, fingerprintHash: string) {
    this.seen.push({ userId, fingerprintHash });
    return 1;
  }
  async deleteAllByUser(userId: string) {
    this.deletedFor.push(userId);
    const before = this.devices.length;
    this.devices = this.devices.filter(d => d.userId !== userId);
    return before - this.devices.length;
  }
}

export class InMemoryBiometricCredentials implements BiometricCredentialRepository {
  constructor(public credentials: BiometricCredential[] = []) {}
  readonly logins: Array<{ credentialId: string; signCount: number }> = [];

  async findByCredentialId(credentialId: string) {
    return copy(this.credentials.find(c => c.credentialId === credentialId && c.isActive));
  }
  async findByIdAndUser(id: string, userId: string) {
    return copy(this.credentials.find(c => c.userBiometricCredentialId === id && c.userId === userId && c.isActive));
  }
  async findByUserAndDevice(userId: string, deviceId: string) {
    return copy(this.credentials.find(c => c.userId === userId && c.userTrustedDeviceId === deviceId && c.isActive));
  }
  async findAllByUser(userId: string) {
    return this.credentials.filter(c => c.userId === userId && c.isActive);
  }
  async create(data: { userId: string; userTrustedDeviceId: string; credentialId: string; publicKey: string; signCount: number }) {
    const created = credential({ ...data, userBiometricCredentialId: `bio-${this.credentials.length + 1}` });
    this.credentials.push(created);
    return created;
  }
  async updateAfterLogin(credentialId: string, signCount: number) {
    this.logins.push({ credentialId, signCount });
    return 1;
  }
  async deactivate(id: string) {
    const found = this.credentials.find(c => c.userBiometricCredentialId === id);
    if (!found) {
      throw new Error(`credencial ${id} inexistente`);
    }
    found.isActive = false;
    return { ...found };
  }
}

export class InMemoryBiometricChallenges implements BiometricChallengeRepository {
  challenges: BiometricChallenge[] = [];
  /** Otro request consume el challenge justo antes (replay). */
  lostRace = false;

  add(challenge: string, userId: string | null, type: ChallengeType): BiometricChallenge {
    const created = {
      biometricChallengeId: `ch-${this.challenges.length + 1}`,
      userId,
      challenge,
      type,
      used: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      createdAt: AT
    };
    this.challenges.push(created);
    return created;
  }
  async create(data: { userId: string | null; challenge: string; type: ChallengeType }) {
    return this.add(data.challenge, data.userId, data.type);
  }
  async findValid(challenge: string) {
    return copy(this.challenges.find(c => c.challenge === challenge && !c.used));
  }
  async markAsUsed(id: string) {
    const found = this.challenges.find(c => c.biometricChallengeId === id);
    if (!found || found.used || this.lostRace) {
      return false;
    }
    found.used = true;
    return true;
  }
}

export class InMemoryCredentialResets implements CredentialResetRepository {
  resets: CredentialResetWithUser[] = [];
  readonly created: Array<{ userId: string; token: string; email: string; type: ResetType; expiresAt: Date }> = [];
  /** Otro request consume el token justo antes. */
  lostRace = false;

  add(token: string, type: ResetType, owner: UserProfile = user()) {
    this.resets.push({
      credentialResetId: `cr-${this.resets.length + 1}`,
      userId: owner.userId,
      token,
      email: owner.person?.contact?.email ?? 'x@correo.co',
      type,
      expiresAt: new Date(Date.now() + 60_000),
      used: false,
      user: {
        userId: owner.userId,
        authUsername: owner.authUsername,
        person: owner.person ? { personId: owner.personId, firstName: owner.person.firstName, contact: owner.person.contact } : null
      }
    });
  }
  async findValidWithUser(token: string) {
    return copy(this.resets.find(r => r.token === token && !r.used));
  }
  async markAsUsed(id: string) {
    const found = this.resets.find(r => r.credentialResetId === id);
    if (!found || found.used || this.lostRace) {
      return false;
    }
    found.used = true;
    return true;
  }
  async invalidateUserTokens(userId: string) {
    const open = this.resets.filter(r => r.userId === userId && !r.used);
    open.forEach(r => (r.used = true));
    return open.length;
  }
  async create(reset: { userId: string; token: string; email: string; type: ResetType; expiresAt: Date }) {
    this.created.push(reset);
  }
}

export class RecordingLoginAttempts implements LoginAttemptRepository {
  readonly attempts: LoginAttempt[] = [];
  block: AccountBlock | null = null;
  async record(attempt: LoginAttempt) {
    this.attempts.push(attempt);
  }
  async findBlock() {
    return this.block;
  }
}

// ── Tokens y revocación ────────────────────────────────────────
/** Tokens legibles: `access.<userId>.<sessionId>`, `refresh.<jti>`, `mfa.<userId>`; los claims quedan en memoria. */
export class FakeTokens implements TokenService {
  readonly accessTokenExpiry = 900;
  readonly access = new Map<string, AccessClaims>();
  readonly refresh = new Map<string, RefreshClaims>();

  async generateAccessToken(tokenUser: TokenUser, sessionId: string | null) {
    const token = `access.${tokenUser.userId}.${sessionId}`;
    this.access.set(token, {
      sessionId,
      userId: tokenUser.userId,
      personId: tokenUser.personId,
      roleId: tokenUser.roleId,
      roleName: tokenUser.role?.name ?? null,
      firstName: tokenUser.person?.firstName ?? null,
      iat: Math.floor(Date.now() / 1000)
    });
    return token;
  }
  async generateRefreshToken(userId: string, jti: string, sessionId: string | null) {
    const token = `refresh.${jti}`;
    this.refresh.set(token, { userId, jti, sessionId, iat: Math.floor(Date.now() / 1000) });
    return token;
  }
  async verifyAccessToken(token: string) {
    const claims = this.access.get(token);
    if (!claims) {
      throw new IamUnauthorizedError('Token inválido');
    }
    return claims;
  }
  async verifyRefreshToken(token: string) {
    const claims = this.refresh.get(token);
    if (!claims) {
      throw new IamUnauthorizedError('Refresh token inválido');
    }
    return claims;
  }
  async generateMfaChallengeToken(userId: string) {
    return `mfa.${userId}`;
  }
  async verifyMfaChallengeToken(token: string) {
    if (!token.startsWith('mfa.')) {
      throw new IamUnauthorizedError('Reto MFA inválido');
    }
    return { userId: token.slice('mfa.'.length) };
  }
}


export class InMemoryRefreshTokens implements RefreshTokenStore {
  readonly jtis = new Map<string, string>();
  readonly rotations = new Map<string, IssuedTokens>();
  readonly revoked: string[] = [];
  saveFails = false;
  /** revoke() falla (Redis caído): el caso de uso solo debe loguearlo. */
  failing = false;

  async save(jti: string, userId: string) {
    if (this.saveFails) {
      return false;
    }
    this.jtis.set(jti, userId);
    return true;
  }
  async revoke(jti: string) {
    if (this.failing) {
      throw new Error('redis caído');
    }
    this.revoked.push(jti);
    this.jtis.delete(jti);
  }
  async exists(jti: string) {
    return this.jtis.get(jti) ?? null;
  }
  async saveRotation(oldJti: string, tokens: IssuedTokens) {
    this.rotations.set(oldJti, tokens);
    return true;
  }
  async getRotation(oldJti: string) {
    return this.rotations.get(oldJti) ?? null;
  }
}

export class InMemoryRevocations implements TokenRevocations {
  readonly accessTokens = new Set<string>();
  readonly refreshTokens = new Set<string>();
  readonly sessions: string[] = [];
  readonly rotations: Array<{ sessionId: string; rotationTs: number }> = [];
  readonly invalidatedUsers = new Set<string>();
  readonly cleared: string[] = [];
  /** Sesiones cuyo umbral ya dejó afuera al token (cerrada o rotada). */
  readonly invalidatedSessions = new Set<string>();
  failing = false;

  async blacklistAccessToken(accessToken: string | null | undefined) {
    if (this.failing) {
      throw new Error('redis caído');
    }
    if (accessToken) {
      this.accessTokens.add(accessToken);
    }
  }
  async blacklistRefreshToken(refreshToken: string) {
    if (this.failing) {
      throw new Error('redis caído');
    }
    this.refreshTokens.add(refreshToken);
  }
  async blacklistSession(sessionId: string) {
    if (this.failing) {
      throw new Error('redis caído');
    }
    this.sessions.push(sessionId);
  }
  async invalidateSessionTokensOnRotation(sessionId: string, rotationTs: number) {
    this.rotations.push({ sessionId, rotationTs });
  }
  async invalidateUserSessions(userId: string) {
    if (this.failing) {
      throw new Error('redis caído');
    }
    this.invalidatedUsers.add(userId);
  }
  async clearUserInvalidation(userId: string) {
    this.cleared.push(userId);
    this.invalidatedUsers.delete(userId);
  }
  async isAccessTokenBlacklisted(accessToken: string) {
    return this.accessTokens.has(accessToken);
  }
  async isRefreshTokenBlacklisted(refreshToken: string) {
    return this.refreshTokens.has(refreshToken);
  }
  async isSessionTokenInvalidated(sessionId: string | null | undefined) {
    return !!sessionId && this.invalidatedSessions.has(sessionId);
  }
  async isUserSessionsInvalidated(userId: string) {
    return this.invalidatedUsers.has(userId);
  }
}

export class InMemoryDeviceBlocklist implements DeviceBlocklist {
  readonly blocked = new Set<string>();
  async block(userId: string, fingerprintHash: string) {
    this.blocked.add(`${userId}:${fingerprintHash}`);
    return true;
  }
  async unblock(userId: string, fingerprintHash: string) {
    return this.blocked.delete(`${userId}:${fingerprintHash}`);
  }
  async isBlocked(userId: string, fingerprintHash: string) {
    return this.blocked.has(`${userId}:${fingerprintHash}`);
  }
}

export class SwitchableCache implements CacheAvailability {
  available = true;
  isAvailable() {
    return this.available;
  }
}

/** Contadores configurables: cada campo es lo que devuelve el método (segundos de bloqueo o null). */
export class FakeRateLimiter implements LoginRateLimiter {
  ipBlock: number | null = null;
  ipIncrement: number | null = null;
  accountBlock: number | null = null;
  accountFailure: number | null = null;
  readonly ipHits: string[] = [];
  readonly failures: string[] = [];
  readonly resets: string[] = [];

  async checkIpBlock() {
    return this.ipBlock;
  }
  async incrementIpAttempts(ip: string) {
    this.ipHits.push(ip);
    return this.ipIncrement;
  }
  async checkAccountBlock() {
    return this.accountBlock;
  }
  async incrementAccountFailures(nationalId: string) {
    this.failures.push(nationalId);
    return this.accountFailure;
  }
  async resetAccountCounters(nationalId: string) {
    this.resets.push(nationalId);
  }
}

// ── Primitivas de seguridad ────────────────────────────────────
/** hash(p) = `hash:p`. */
export const fakePasswords: PasswordHasher = {
  hash: async plain => `hash:${plain}`,
  matches: async (plain, passwordHash) => passwordHash === `hash:${plain}`
};

export const TOTP_SECRET = 'TOTPSECRET';
export const VALID_TOTP = '246810';

/** Un solo código vale: VALID_TOTP con el secreto TOTP_SECRET. */
export const fakeTotp: TotpService = {
  generateSecret: () => TOTP_SECRET,
  keyuri: (account, secret) => `otpauth://totp/${account}?secret=${secret}`,
  verify: (code, secret) => code === VALID_TOTP && secret === TOTP_SECRET
};

export const fakeCipher: SecretCipher = {
  encrypt: plain => `enc(${plain})`,
  decrypt: encrypted => encrypted.replace(/^enc\((.*)\)$/, '$1')
};

/** Valores predecibles: uuid-1, uuid-2…; hex y base64url numerados; int devuelve `nextInt`. */
export class SequentialRandom implements RandomSource {
  private n = 0;
  nextInt = 654321;
  uuid() {
    return `uuid-${++this.n}`;
  }
  hex(bytes: number) {
    return `hex${bytes}-${++this.n}`;
  }
  base64url() {
    return `challenge-${++this.n}`;
  }
  int() {
    return this.nextInt;
  }
}

export class FakeSignatures implements SignatureVerifier {
  valid = true;
  readonly checked: Array<{ publicKey: string; challenge: string; signature: string }> = [];
  verify(input: { publicKey: string; challenge: string; signature: string }) {
    this.checked.push(input);
    return this.valid;
  }
}

export const DESCRIBED: DeviceDescription = {
  browser: 'Firefox',
  os: 'Linux',
  deviceType: 'desktop',
  city: 'Bogotá',
  country: 'Colombia',
  countryCode: 'CO',
  deviceName: 'Firefox en Linux'
};

export const fakeDescriber: DeviceDescriber = { describe: () => DESCRIBED };

/** sign = `sig(timestamp:method:path:secret)`. */
export const fakeSigner: RequestSigner = {
  sign: (timestamp, method, path, secret) => `sig(${timestamp}:${method}:${path}:${secret})`,
  matches: (received, expected) => received === expected
};

export const fakeApiKeys: ApiKeyVerifier = {
  isValid: (apiKey: string | undefined): apiKey is string => apiKey === 'key-ok'
};

/** Como en producción: los errores de dominio ya dicen qué responder; el resto se envuelve. */
export const domainErrorPolicy: ErrorPolicy = { shouldPropagate: error => error instanceof DomainError };

export class RecordingOperationSession implements OperationSession {
  readonly binds: Array<{ sessionId: string | null; userId: string | null }> = [];
  bind(sessionId: string | null, userId: string | null) {
    this.binds.push({ sessionId, userId });
  }
}

// ── Lo que viene de otros módulos ──────────────────────────────
export class InMemoryHolders implements AccountHolders {
  constructor(readonly persons: Map<string, PersonProfileRef>) {}
  readonly emailsInUse = new Set<string>();
  readonly nationalIdsInUse = new Set<string>();
  readonly created: Array<{ holder: NewAccountHolder; contact: { email: string; emailVerifiedAt: Date } }> = [];
  readonly nameUpdates: Array<{ personId: string; names: Record<string, unknown> }> = [];
  /** Dueños de un email (findByEmail). */
  readonly owners = new Map<string, { personId: string; firstName: string }>();
  failWith: Error | null = null;

  async create(holder: NewAccountHolder, contactData: { email: string; emailVerifiedAt: Date }): Promise<CreatedAccountHolder> {
    if (this.failWith) {
      throw this.failWith;
    }
    this.created.push({ holder, contact: contactData });
    const personId = `p-${this.created.length}`;
    const base = person({
      personId,
      firstName: holder.firstName,
      lastName: holder.lastName,
      nationalId: holder.nationalId,
      documentTypeId: holder.documentTypeId ?? null
    });
    const built = { ...base, contact: base.contact ? { ...base.contact, email: contactData.email } : null };
    this.persons.set(personId, built);
    const { contact, gender: _g, country: _c, documentType: _d, location: _l, ...rest } = built;
    if (!contact) {
      throw new Error('persona sin contacto');
    }
    return { person: rest, contact };
  }
  async emailInUse(email: string) {
    return this.emailsInUse.has(email);
  }
  async nationalIdInUse(nationalId: string) {
    return this.nationalIdsInUse.has(nationalId);
  }
  async findByEmail(email: string) {
    return this.owners.get(email) ?? null;
  }
  async updateNames(personId: string, names: { firstName: string; middleName: string | null; lastName: string; secondLastName: string | null }) {
    this.nameUpdates.push({ personId, names });
  }
}

export class FakeIdentityChecks implements IdentityChecks {
  readonly takenNationalIds = new Set<string>();
  readonly takenEmails = new Set<string>();
  async assertNationalIdAvailable(nationalId: string) {
    if (this.takenNationalIds.has(nationalId)) {
      throw new IamConflictError('El número de documento ya está registrado');
    }
  }
  async assertEmailAvailable(email: string) {
    if (this.takenEmails.has(email)) {
      throw new IamConflictError('El email ya está registrado');
    }
  }
}

export class RecordingAnonymizer implements AccountAnonymizer {
  readonly anonymized: Array<Parameters<AccountAnonymizer['anonymize']>[0]> = [];
  async anonymize(input: Parameters<AccountAnonymizer['anonymize']>[0]) {
    this.anonymized.push(input);
  }
}

export const fixedTemporaryPassword: TemporaryPasswords = { generate: () => 'Temp#Pass12' };

export class FakePrivacyPolicies implements PrivacyPolicies {
  active: ActivePolicy | null = null;
  async findActive() {
    return this.active;
  }
}

export class RecordingConsents implements ConsentRecorder {
  readonly granted: Array<{ kind: string; userId: string; privacyPolicyId?: string; ip: string | null }> = [];
  failWith: Error | null = null;
  async grantPrivacyPolicy(input: { userId: string; privacyPolicyId?: string; ip: string | null }) {
    if (this.failWith) {
      throw this.failWith;
    }
    this.granted.push({ kind: 'PRIVACY_POLICY', ...input });
    return { userConsentId: `uc-${this.granted.length}` };
  }
  async grantCommercialCommunications(input: { userId: string; ip: string | null }) {
    this.granted.push({ kind: 'COMUNICACIONES_COMERCIALES', ...input });
    return { userConsentId: `uc-${this.granted.length}` };
  }
}

export class InMemoryVerificationCodes implements VerificationCodes {
  codes: Array<OtpCode & { kind: ContactKind; value: string }> = [];
  readonly verified = new Set<string>();
  readonly consumed: string[] = [];
  waitSeconds = 0;

  /** Un código vigente para ese contacto. */
  add(kind: ContactKind, value: string, code: string, attempts = 0) {
    this.codes.push({ verificationCodeId: `vc-${this.codes.length + 1}`, kind, value, code, attempts, verifiedAt: null, expiresAt: new Date(Date.now() + 60_000) });
  }
  async secondsUntilNewCode() {
    return this.waitSeconds;
  }
  async create(code: { type: ContactKind; contactValue: string; code: string; expiresAt: Date }) {
    const created = { verificationCodeId: `vc-${this.codes.length + 1}`, kind: code.type, value: code.contactValue, code: code.code, attempts: 0, verifiedAt: null, expiresAt: code.expiresAt };
    this.codes.push(created);
    return { verificationCodeId: created.verificationCodeId };
  }
  async findActive(kind: ContactKind, value: string) {
    const matching = this.codes.filter(c => c.kind === kind && c.value === value);
    return copy(matching[matching.length - 1]);
  }
  async incrementAttempts(id: string) {
    const found = this.codes.find(c => c.verificationCodeId === id);
    if (found) {
      found.attempts = (found.attempts ?? 0) + 1;
    }
  }
  async markAsVerified(id: string) {
    const found = this.codes.find(c => c.verificationCodeId === id);
    if (found) {
      found.verifiedAt = new Date();
    }
  }
  async isVerified(kind: ContactKind, value: string) {
    return this.verified.has(`${kind}:${value}`);
  }
  async consumeVerified(kind: ContactKind, value: string) {
    this.consumed.push(`${kind}:${value}`);
  }
}

export class RecordingSms implements SmsSender {
  readonly sent: Array<{ phoneNumber: string; message: string; userId: string | null; purpose: string }> = [];
  async send(sms: { phoneNumber: string; message: string; userId: string | null; purpose: string }) {
    this.sent.push(sms);
    return { success: true };
  }
  async resolveE164(localNumber: string) {
    return `+57${localNumber}`;
  }
}

export class RecordingPushDevices implements PushDevices {
  readonly registered: Array<{ userId: string; token: string; platform: string; deviceId: string | null }> = [];
  async register(input: { userId: string; token: string; platform: string; deviceId: string | null }) {
    this.registered.push(input);
  }
}

export class RecordingPreferences implements NotificationPreferences {
  readonly created: string[] = [];
  failWith: Error | null = null;
  async createDefault(userId: string) {
    if (this.failWith) {
      throw this.failWith;
    }
    this.created.push(userId);
  }
}

export class FakeCatalogs implements CatalogLookups {
  country: { countryId: string } | null = { countryId: 'co' };
  readonly documentTypes = new Map<string, DocumentTypeEntry>([['dt-cc', { documentTypeId: 'dt-cc', isActive: true, isVisibleToClient: true }]]);
  systemDocumentType: { documentTypeId: string } | null = { documentTypeId: 'dt-system' };
  readonly genders = new Set<string>(['g-f']);

  async countryByCode() {
    return this.country;
  }
  async documentType(documentTypeId: string) {
    return this.documentTypes.get(documentTypeId) ?? null;
  }
  async documentTypeByCode() {
    return this.systemDocumentType;
  }
  async genderExists(genderId: string) {
    return this.genders.has(genderId);
  }
}

export class RecordingChangeLog implements AccountChangeLog {
  readonly changes: AccountChange[] = [];
  async record(change: AccountChange) {
    this.changes.push(change);
  }
}

export class RecordingAuthAttempts implements AuthAttemptLog {
  readonly criteria: AuthAttemptCriteria[] = [];
  rows: AuthAttempt[] = [];
  async list(criteria: AuthAttemptCriteria) {
    this.criteria.push(criteria);
    return { rows: this.rows, count: this.rows.length };
  }
}

export class InMemoryChangeHistory implements AccountChangeHistory {
  rows: AccountChangeRecord[] = [];
  async listByUser() {
    return { rows: this.rows, count: this.rows.length };
  }
}

export class FakeDualApproval implements DualApproval {
  result: { pending: true; request: unknown } | { pending: false } = { pending: false };
  readonly gated: Array<{ operationKey: string; input: unknown }> = [];
  readonly pending = new Map<string, unknown>();
  async gate(operationKey: 'RBAC_ROLE_CHANGE' | 'INTERNAL_USER_DELETE', input: Parameters<DualApproval['gate']>[1]) {
    this.gated.push({ operationKey, input });
    return this.result;
  }
  async findPending(_entityType: string, entityIds: string[]) {
    return new Map([...this.pending].filter(([id]) => entityIds.includes(id)));
  }
}

// ── Transversales ──────────────────────────────────────────────
export class RecordingAudit implements AuditTrail {
  readonly entries: Array<{ action: string } & AuditEntry> = [];
  async record(action: string, entry: AuditEntry) {
    this.entries.push({ action, ...entry });
  }
  actions() {
    return this.entries.map(e => e.action);
  }
  find(action: string) {
    return this.entries.find(e => e.action === action);
  }
}

export class RecordingLogger implements Logger {
  readonly lines: Array<{ level: string; message: string; meta?: LogMeta }> = [];
  debug(message: string, meta?: LogMeta) {
    this.lines.push({ level: 'debug', message, meta });
  }
  info(message: string, meta?: LogMeta) {
    this.lines.push({ level: 'info', message, meta });
  }
  warn(message: string, meta?: LogMeta) {
    this.lines.push({ level: 'warn', message, meta });
  }
  error(message: string, meta?: LogMeta) {
    this.lines.push({ level: 'error', message, meta });
  }
  warnings() {
    return this.lines.filter(l => l.level === 'warn').map(l => l.message);
  }
}

/** Cuenta las transacciones y las que se revirtieron (la escritura en memoria no se deshace: se mira el contador). */
export class RecordingUnitOfWork implements UnitOfWork {
  runs = 0;
  rollbacks = 0;
  async run<T>(work: () => PromiseLike<T>) {
    this.runs++;
    try {
      return await work();
    } catch (error) {
      this.rollbacks++;
      throw error;
    }
  }
}

export const POLICY: IamPolicy = {
  session: { maxActiveSessions: 3, inactivityMinutes: 15, accessThrottleSeconds: 60, absoluteLifetimeHours: 8 },
  maxAccountAttempts: 5,
  resetTokenMinutes: 15,
  resetCredentialUrl: 'https://front.test/reset',
  mockOtpCodes: false,
  requireMobileSignature: false,
  notificationLogoUrl: 'https://cdn.test/logo.png'
};

/** Todas las dependencias de iam, con dobles en memoria. `users` arranca con un cliente (CLIENT_ID). */
export function iamWorld(users: UserProfile[] = [user()]) {
  const persons = new Map<string, PersonProfileRef>();
  const world = {
    policy: { ...POLICY, session: { ...POLICY.session } },
    audit: new RecordingAudit(),
    logger: new RecordingLogger(),
    notifier: new RecordingNotices(),
    unitOfWork: new RecordingUnitOfWork(),

    users: new InMemoryUsers(users, persons),
    roles: new InMemoryRoles(),
    overrides: new InMemoryOverrides(),
    overrideCache: new InMemoryOverrideCache(),
    sessions: new InMemorySessions(),
    devices: new InMemoryDevices(),
    biometricCredentials: new InMemoryBiometricCredentials(),
    biometricChallenges: new InMemoryBiometricChallenges(),
    credentialResets: new InMemoryCredentialResets(),
    loginAttempts: new RecordingLoginAttempts(),

    tokens: new FakeTokens(),
    refreshTokens: new InMemoryRefreshTokens(),
    revocations: new InMemoryRevocations(),
    deviceBlocklist: new InMemoryDeviceBlocklist(),
    cache: new SwitchableCache(),
    rateLimiter: new FakeRateLimiter(),

    passwords: fakePasswords,
    totp: fakeTotp,
    cipher: fakeCipher,
    random: new SequentialRandom(),
    signatures: new FakeSignatures(),
    deviceDescriber: fakeDescriber,
    requestSigner: fakeSigner,
    apiKeys: fakeApiKeys,
    errors: domainErrorPolicy,
    operationSession: new RecordingOperationSession(),

    holders: new InMemoryHolders(persons),
    identity: new FakeIdentityChecks(),
    anonymizer: new RecordingAnonymizer(),
    temporaryPasswords: fixedTemporaryPassword,
    privacyPolicies: new FakePrivacyPolicies(),
    consents: new RecordingConsents(),
    verificationCodes: new InMemoryVerificationCodes(),
    sms: new RecordingSms(),
    pushDevices: new RecordingPushDevices(),
    preferences: new RecordingPreferences(),
    catalogs: new FakeCatalogs(),
    changeLog: new RecordingChangeLog(),
    authAttempts: new RecordingAuthAttempts(),
    changeHistory: new InMemoryChangeHistory(),
    approvals: new FakeDualApproval()
  };
  return world satisfies IamDeps;
}

export type IamWorld = ReturnType<typeof iamWorld>;

/** Las piezas compartidas del login (como las arma iam.module.ts). */
export function loginSteps(w: IamWorld) {
  return {
    sessionIssuer: new SessionIssuer(w),
    sessionControl: new SessionControl(w),
    policyGate: new LoginPolicyGate(w),
    loginDevices: new LoginDeviceResolver(w),
    smsChallenge: new SmsLoginChallenge(w)
  };
}

/** Espera a que corra lo que los casos de uso dejan en segundo plano (setImmediate, promesas sin await). */
export async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
  }
}
