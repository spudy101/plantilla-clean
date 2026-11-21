// La salida de cada constructor de iam cumple su esquema (y por lo tanto su documentación).
import components, {
  BiometricCredentialSchema,
  TrustedDeviceSchema,
  UserChangeLogSchema,
  UserSessionSchema,
  VerificationCodeSchema
} from './auth-components.response';
import loginDto, {
  AuthTokensSchema,
  DeviceApprovalRequiredSchema,
  LoginSchema,
  MfaRequiredSchema,
  PolicyUpdateRequiredSchema,
  TrustedDeviceListSchema,
  TrustedDeviceUpdateSchema
} from './auth-login.response';
import registerDto, { RegisterSchema } from './auth-register.response';
import biometricDto, {
  BiometricCredentialListSchema,
  BiometricLoginStartSchema,
  BiometricRegisterFinishSchema,
  BiometricRegisterStartSchema
} from './auth-biometric.response';
import mfaDto, {
  MfaStatusSchema,
  PreferredMethodSchema,
  SmsActivationRequestSchema,
  SmsMfaActivationSchema,
  TotpActivationSchema,
  TotpSetupSchema,
  ValidationResultSchema
} from './mfa.response';
import sessionDto, { AdminSessionSchema, AuthAttemptSchema } from './admin-auth-session.response';
import userDto, {
  InternalUserCreatedSchema,
  InternalUserListItemSchema,
  InternalUserSchema,
  RoleOptionSchema
} from './admin-user.response';
import rbacDto, {
  EffectivePermissionsSchema,
  RbacCatalogSchema,
  RoleMatrixEntrySchema,
  RolePermissionOverrideSchema,
  RolePermissionsListSchema
} from './admin-rbac.response';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const at = new Date('2026-01-01T00:00:00Z');
const userRef = { userId: ID, username: 'ana', person: { firstName: 'Ana', lastName: 'Pérez' } };
const session = {
  userSessionId: ID,
  userId: ID,
  status: 'active',
  ipAddress: '1.1.1.1',
  userAgent: 'jest',
  startedAt: at,
  lastAccessAt: at,
  closedAt: null,
  closeReason: null,
  createdAt: at,
  sessionUser: userRef,
  device: {
    userTrustedDeviceId: ID,
    deviceName: 'PC',
    deviceType: 'desktop',
    browser: 'Chrome',
    os: 'Windows',
    status: 'trusted'
  }
};
const device = {
  userTrustedDeviceId: ID,
  userId: ID,
  deviceName: 'iPhone',
  fingerprintHash: 'abc',
  status: 'trusted',
  ipAddress: null,
  city: null,
  country: null,
  countryCode: null,
  browser: null,
  os: 'iOS',
  deviceType: null,
  approvedByDeviceId: null,
  approvedAt: null,
  blockedByDeviceId: null,
  blockedAt: null,
  trustedAt: at,
  lastSeenAt: at,
  createdAt: at,
  updatedAt: at,
  sessions: [session]
};
const credential = {
  userBiometricCredentialId: ID,
  userTrustedDeviceId: ID,
  credentialId: 'cred',
  signCount: 3,
  isActive: true,
  lastUsedAt: null,
  createdAt: at
};
const role = { roleId: ID, name: 'ADMIN', description: null, isActive: true, createdAt: at, updatedAt: at };
const person = {
  personId: ID,
  firstName: 'Ana',
  lastName: 'Pérez',
  middleName: null,
  secondLastName: null,
  nationalId: null,
  birthDate: null,
  genderId: null,
  countryId: null,
  documentTypeId: null,
  createdAt: at,
  updatedAt: at,
  gender: { genderId: ID, name: 'Femenino' },
  contact: {
    personContactId: ID,
    personId: ID,
    email: 'ana@correo.co',
    emailVerifiedAt: null,
    phonePrimary: null,
    phoneSecondary: null
  }
};
const user = {
  userId: ID,
  username: 'ana',
  personId: ID,
  roleId: ID,
  avatarId: null,
  isActive: true,
  deletedAt: null,
  totpEnabled: true,
  smsMfaEnabled: false,
  preferredMfaMethod: 'totp',
  privacyPolicyVersion: null,
  privacyPolicyAcceptedAt: null,
  privacyPolicyAcceptedIp: null,
  createdAt: at,
  updatedAt: at,
  role,
  person,
  pendingApproval: null
};
const tokens = { accessToken: 'a', refreshToken: 'r', expiresIn: 3600 };

const ok = (schema: { safeParse(v: unknown): { error?: { issues: unknown[] } } }, value: unknown) =>
  expect(schema.safeParse(value).error?.issues ?? []).toEqual([]);

describe('esquemas de salida de iam', () => {
  it('componentes: sesión, cambio de cuenta, código, dispositivo y credencial', () => {
    ok(UserSessionSchema, components.UserSessionComponent.build(session));
    ok(
      UserChangeLogSchema,
      components.UserChangeLogComponent.build({
        logId: ID,
        userId: ID,
        user: userRef,
        changedByUserId: null,
        changedByRole: 'system',
        changedBy: null,
        changeType: 'email',
        previousValue: 'ana@correo.co',
        newValue: 'ana2@correo.co',
        changeReason: null,
        ipAddress: null,
        userAgent: null,
        originSessionId: null,
        createdAt: at
      })
    );
    ok(
      VerificationCodeSchema,
      components.VerificationCodeComponent.build({
        verificationCodeId: ID,
        type: 'email',
        contactValue: 'ana@correo.co',
        attempts: 0,
        expiresAt: at,
        createdAt: at
      })
    );
    ok(TrustedDeviceSchema, components.TrustedDeviceComponent.build(device, null, ID));
    ok(BiometricCredentialSchema, components.BiometricCredentialComponent.build(credential));
  });

  it('login, registro y respuestas intermedias', () => {
    ok(LoginSchema, loginDto.LoginResponseDTO({ user: user as never, tokens, deviceId: ID, deviceHmacSecret: 'secret' }));
    ok(
      PolicyUpdateRequiredSchema,
      loginDto.PolicyUpdateRequiredDTO({
        currentVersion: '1.0',
        newVersion: '2.0',
        documentUrl: 'https://x',
        summary: null,
        effectiveDate: at
      })
    );
    ok(DeviceApprovalRequiredSchema, loginDto.DeviceApprovalRequiredDTO({ deviceId: ID }));
    ok(
      MfaRequiredSchema,
      loginDto.MFARequiredResponseDTO({
        username: 'ana',
        session: 's',
        challengeType: 'SOFTWARE_TOKEN_MFA',
        preferredMfaMethod: 'totp'
      })
    );
    ok(AuthTokensSchema, loginDto.RefreshTokenResponseDTO(tokens));
    ok(TrustedDeviceListSchema, loginDto.TrustedDeviceListDTO([device]));
    ok(
      TrustedDeviceUpdateSchema,
      loginDto.TrustedDeviceUpdateDTO({ userTrustedDeviceId: ID, deviceName: 'PC', status: 'trusted', updatedAt: at } as never)
    );
    ok(
      RegisterSchema,
      registerDto.RegisterResponseDTO({
        user: user as never,
        person: person as never,
        personContact: person.contact as never,
        tokens
      })
    );
  });

  it('biometría y MFA', () => {
    ok(BiometricRegisterStartSchema, biometricDto.BiometricRegisterStartDTO({ challenge: 'c', deviceId: ID, algorithm: -7 }));
    ok(BiometricRegisterFinishSchema, biometricDto.BiometricRegisterFinishDTO(credential));
    ok(BiometricLoginStartSchema, biometricDto.BiometricLoginStartDTO({ challenge: 'c', userId: null }));
    ok(BiometricCredentialListSchema, biometricDto.BiometricCredentialListDTO([credential]));
    const account = { userId: ID, username: 'ana' };
    ok(TotpSetupSchema, mfaDto.TOTPSetupResponseDTO({ otpauthUrl: 'otpauth://x', secretCode: 'S', username: 'ana' }));
    ok(TotpActivationSchema, mfaDto.TOTPActivationResponseDTO({ ...account, totpEnabled: true }));
    ok(ValidationResultSchema, mfaDto.TOTPVerificationResponseDTO({ valid: true, username: 'ana' }));
    ok(ValidationResultSchema, mfaDto.PasswordValidationResponseDTO({ valid: false, username: null }));
    ok(SmsMfaActivationSchema, mfaDto.SMSMFAActivationResponseDTO({ ...account, smsMfaEnabled: true }));
    ok(PreferredMethodSchema, mfaDto.PreferredMethodResponseDTO({ ...account, preferredMfaMethod: 'sms' }));
    ok(
      MfaStatusSchema,
      mfaDto.MFAStatusResponseDTO({ ...account, totpEnabled: true, smsMfaEnabled: false, preferredMfaMethod: 'totp' })
    );
    ok(
      SmsActivationRequestSchema,
      mfaDto.SMSActivationRequestResponseDTO({ verificationCodeId: ID, expiresAt: at, truncatedCode: null })
    );
  });

  it('admin: sesiones, intentos, usuarios internos y RBAC', () => {
    ok(AdminSessionSchema, sessionDto.SessionDTO(session as never));
    ok(
      AuthAttemptSchema,
      sessionDto.AuthAttemptDTO({
        auditLogId: ID,
        action: 'LOGIN_FAILED',
        description: null,
        outcome: 'failure',
        risk: 'medium',
        userId: ID,
        executor: userRef,
        ip: '1.1.1.1',
        userAgent: null,
        createdAt: at,
        details: { errorMessage: 'x' }
      } as never)
    );
    ok(InternalUserSchema, userDto.InternalUserDTO(user as never));
    ok(InternalUserListItemSchema, userDto.InternalUserListDTO(user as never));
    ok(InternalUserCreatedSchema, userDto.InternalUserCreatedDTO(user as never, 'Temp#1'));
    ok(RoleOptionSchema, userDto.RoleOptionDTO(role));
    ok(
      RbacCatalogSchema,
      rbacDto.RbacCatalogDTO({
        groups: [
          { key: 'a', label: 'A', modules: [] },
          { key: 'b', label: 'B', modules: ['m'], parent: 'a' }
        ],
        modules: [],
        actions: []
      })
    );
    rbacDto
      .RoleMatrixDTO([{ role: 'ADMIN', basePermissions: {}, addedPermissions: {} }])
      .forEach(e => ok(RoleMatrixEntrySchema, e));
    ok(EffectivePermissionsSchema, rbacDto.EffectivePermissionsDTO('ADMIN', { kyc: ['READ'] }));
    const override = {
      rolePermissionOverrideId: ID,
      roleName: 'ADMIN',
      moduleName: 'kyc',
      action: 'READ',
      grantedByUserId: ID,
      grantedBy: userRef,
      createdAt: at
    };
    ok(RolePermissionOverrideSchema, rbacDto.RolePermissionOverrideDTO(override as never));
    ok(RolePermissionsListSchema, rbacDto.RolePermissionsListDTO('ADMIN', [override as never]));
  });
});
