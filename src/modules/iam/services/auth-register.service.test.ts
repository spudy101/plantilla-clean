// tests/unit/modules/client/kyc/iam/services/auth-register.service.test.ts
//
// AuthRegisterService — registro público y reset de credenciales. Servicio grande: cubrimos las
// ramas principales de register() (prerrequisitos, validación de unicidad, creación transaccional,
// emisión de tokens, notificaciones best-effort), y los flujos de
// requestResetCredentials() (anti-enumeración) y confirmResetCredentials() (password/mfa/guardas).
// Todo dependencia se mockea inline; crypto real; AppError real (autocontenido).

// setImmediate en cuerpo de bloque para evitar no-promise-executor-return.
const flush = () =>
  new Promise(resolve => {
    setImmediate(resolve);
  });

jest.mock('uuid', () => ({ v4: jest.fn(() => 'uuid-fijo') }));

jest.mock('../repositories/user.repository', () => ({
  findByUserId: jest.fn(),
  createWithPassword: jest.fn(),
  update: jest.fn(),
  updatePassword: jest.fn()
}));
jest.mock('../../person/repositories/person.repository', () => ({
  findByNationalId: jest.fn(),
  create: jest.fn()
}));
jest.mock('../../person/repositories/person-contact.repository', () => ({
  findByEmail: jest.fn(),
  findByEmailWithUser: jest.fn(),
  create: jest.fn()
}));
jest.mock('../../catalogs/infrastructure/persistence/prisma-document-type.repository', () => ({
  findById: jest.fn()
}));
jest.mock('../repositories/credential-reset.repository', () => ({
  invalidateUserTokens: jest.fn(),
  createResetToken: jest.fn(),
  findValidTokenWithUser: jest.fn(),
  markAsUsed: jest.fn()
}));
jest.mock('../../notification/repositories/user-notification-preference.repository', () => ({
  upsert: jest.fn()
}));
jest.mock('../../catalogs/infrastructure/persistence/prisma-country.repository', () => ({
  findByCode: jest.fn()
}));
jest.mock('../../legal/repositories/privacy-policy.repository', () => ({
  findActive: jest.fn()
}));
jest.mock('../../legal/repositories/user-consent.repository', () => ({
  grant: jest.fn()
}));
jest.mock('../../legal/repositories/consent-type.repository', () => ({
  findByCode: jest.fn()
}));
jest.mock('../../catalogs/infrastructure/persistence/prisma-gender.repository', () => ({
  exists: jest.fn()
}));
jest.mock('../../notification/repositories/verification-code.repository', () => ({
  findVerifiedByContact: jest.fn(),
  deleteVerifiedByContact: jest.fn()
}));
jest.mock('../repositories/role.repository', () => ({
  findByName: jest.fn()
}));
jest.mock('../repositories/user-session.repository', () => ({
  create: jest.fn(),
  closeAllByUser: jest.fn()
}));

jest.mock('../../../shared/infrastructure/security/jwt.util', () => ({
  generateAccessToken: jest.fn(),
  generateRefreshToken: jest.fn()
}));
jest.mock('../utils/refresh-token-store.util', () => ({
  save: jest.fn()
}));
jest.mock('../../person/utils/kyc-shared.util', () => ({
  logChange: jest.fn()
}));
jest.mock('../utils/token-blacklist.util', () => ({
  invalidateUserSessions: jest.fn()
}));
jest.mock('../../notification/notify', () => ({
  notify: jest.fn(),
  notifyEmail: jest.fn()
}));
jest.mock('../../../shared/infrastructure/observability/request-context.util', () => ({
  originFromContext: jest.fn(() => ({}))
}));
jest.mock('../../../shared/infrastructure/database/prisma', () => ({ __esModule: true, default: { $transaction: jest.fn() } }));
jest.mock('../responses/auth-register.response', () => ({
  RegisterResponseDTO: jest.fn(x => ({ dto: true, userId: x.user?.userId, tokens: x.tokens }))
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

// mockConstants es la MISMA referencia devuelta por la factory.
const mockConstants = {
  CONSENT_TYPE_CODES: { PRIVACY_POLICY: 'PRIVACY_POLICY', COMUNICACIONES_COMERCIALES: 'COMUNICACIONES_COMERCIALES' },
  frontend: { resetCredentialUrl: 'https://front/reset' },
  SECURITY: { RESET_TOKEN_EXPIRATION_MINUTES: 15 },
  RBAC_ROLES: { CLIENTE: 'CLIENTE' },
  server: { nodeEnv: 'test' },
  notifications: { ses: { logoUrl: 'https://logo' } },
  jwt: { accessTokenExpiry: '15m' }
};
jest.mock('../../../shared/infrastructure/config', () => mockConstants);

import { managedTransaction } from 'tests/helpers/transaction';
import { mocked } from 'tests/helpers/mock';
import catalogsModule from '../../catalogs';
import userRepositoryModule from '../repositories/user.repository';
const userRepository = mocked(userRepositoryModule);
import personRepositoryModule from '../../person/repositories/person.repository';
const personRepository = mocked(personRepositoryModule);
import personContactRepositoryModule from '../../person/repositories/person-contact.repository';
const personContactRepository = mocked(personContactRepositoryModule);
const documentTypeRepositoryModule = catalogsModule.documentTypeRepository;
const documentTypeRepository = mocked(documentTypeRepositoryModule);
import resetCredentialsRepositoryModule from '../repositories/credential-reset.repository';
const credentialResetRepository = mocked(resetCredentialsRepositoryModule);
import userNotificationPreferenceRepositoryModule from '../../notification/repositories/user-notification-preference.repository';
const userNotificationPreferenceRepository = mocked(userNotificationPreferenceRepositoryModule);
const countryRepositoryModule = catalogsModule.countryRepository;
const countryRepository = mocked(countryRepositoryModule);
import privacyPolicyRepositoryModule from '../../legal/repositories/privacy-policy.repository';
const privacyPolicyRepository = mocked(privacyPolicyRepositoryModule);
import userConsentRepositoryModule from '../../legal/repositories/user-consent.repository';
const userConsentRepository = mocked(userConsentRepositoryModule);
import consentTypeRepositoryModule from '../../legal/repositories/consent-type.repository';
const consentTypeRepository = mocked(consentTypeRepositoryModule);
const genderRepositoryModule = catalogsModule.genderRepository;
const genderRepository = mocked(genderRepositoryModule);
import verificationCodeRepositoryModule from '../../notification/repositories/verification-code.repository';
const verificationCodeRepository = mocked(verificationCodeRepositoryModule);
import roleRepositoryModule from '../repositories/role.repository';
const roleRepository = mocked(roleRepositoryModule);
import userSessionRepositoryModule from '../repositories/user-session.repository';
const userSessionRepository = mocked(userSessionRepositoryModule);
import JwtUtilModule from '../../../shared/infrastructure/security/jwt.util';
const JwtUtil = mocked(JwtUtilModule);
import RefreshTokenStoreModule from '../utils/refresh-token-store.util';
const RefreshTokenStore = mocked(RefreshTokenStoreModule);
import KycSharedUtilModule from '../../person/utils/kyc-shared.util';
const KycSharedUtil = mocked(KycSharedUtilModule);
import TokenBlacklistUtilModule from '../utils/token-blacklist.util';
const TokenBlacklistUtil = mocked(TokenBlacklistUtilModule);
import NotificationUtilModule from '../../notification/notify';
const notifier = mocked(NotificationUtilModule);
import prismaModule from '../../../shared/infrastructure/database/prisma';
const prisma = mocked(prismaModule);
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;

import service from './auth-register.service';

const VALID_USER_DATA = {
  email: 'nuevo@x.com',
  password: 'Secret123!',
  firstName: 'Ada',
  middleName: null,
  lastName: 'Lovelace',
  secondLastName: null,
  nationalId: '12345678',
  documentTypeId: 'dt-1',
  genderId: null,
  birthDate: '1990-01-01',
  comunicacionesComerciales: false
};

// Configura todas las dependencias para un register() por el camino feliz.
function armHappyRegister() {
  countryRepository.findByCode.mockResolvedValue({ countryId: 'co-1' });
  privacyPolicyRepository.findActive.mockResolvedValue({ version: 'v1', privacyPolicyId: 'pp-1' });
  verificationCodeRepository.findVerifiedByContact.mockResolvedValue({ verified: true });
  verificationCodeRepository.deleteVerifiedByContact.mockResolvedValue(undefined);
  documentTypeRepository.findById.mockResolvedValue({ documentTypeId: 'dt-1', isActive: true, isVisibleToClient: true });
  personContactRepository.findByEmail.mockResolvedValue(null);
  personRepository.findByNationalId.mockResolvedValue(null);

  prisma.$transaction.mockImplementation(
    managedTransaction({
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined)
    })
  );
  roleRepository.findByName.mockResolvedValue({ roleId: 'role-cliente' });
  personRepository.create.mockResolvedValue({ personId: 'p-1' });
  personContactRepository.create.mockResolvedValue({ personContactId: 'pc-1' });
  userRepository.createWithPassword.mockResolvedValue({ userId: 'u-1' });
  userNotificationPreferenceRepository.upsert.mockResolvedValue({});
  consentTypeRepository.findByCode.mockResolvedValue({ consentTypeId: 'ct-1' });
  userConsentRepository.grant.mockResolvedValue({ userConsentId: 'uc-1' });

  userRepository.findByUserId.mockResolvedValue({ userId: 'u-1', role: {}, person: {} });
  JwtUtil.generateAccessToken.mockResolvedValue('access-tok');
  JwtUtil.generateRefreshToken.mockResolvedValue('refresh-tok');
  RefreshTokenStore.save.mockResolvedValue(true);
  userSessionRepository.create.mockResolvedValue({});
  notifier.notify.mockResolvedValue(undefined);
}

describe('AuthRegisterService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConstants.server.nodeEnv = 'test';
  });

  describe('register — camino feliz', () => {
    it('crea el usuario, emite tokens, audita y devuelve el DTO de respuesta', async () => {
      armHappyRegister();

      const result = await service.register(VALID_USER_DATA, { ip: '9.9.9.9', userAgent: 'jest' });

      expect(personRepository.create).toHaveBeenCalled();
      expect(userRepository.createWithPassword).toHaveBeenCalledWith(
        expect.objectContaining({ authUsername: 'user_uuid-fijo', personId: 'p-1', roleId: 'role-cliente' })
      );
      expect(userConsentRepository.grant).toHaveBeenCalledTimes(1); // solo privacy policy (comunicaciones=false)
      expect(JwtUtil.generateAccessToken).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('USER_REGISTERED', expect.objectContaining({ actorId: 'u-1' }));
      expect(result).toMatchObject({ dto: true, userId: 'u-1', tokens: { accessToken: 'access-tok', refreshToken: 'refresh-tok', expiresIn: '15m' } });

      await flush();
      expect(verificationCodeRepository.deleteVerifiedByContact).toHaveBeenCalledWith('email', VALID_USER_DATA.email);
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'BIENVENIDA', userId: 'u-1' })
      );
    });

    it('registra también el consentimiento de comunicaciones comerciales cuando se acepta', async () => {
      armHappyRegister();
      await service.register({ ...VALID_USER_DATA, comunicacionesComerciales: true }, {});
      expect(userConsentRepository.grant).toHaveBeenCalledTimes(2);
    });

    // Con users en Prisma (grupo 6), consentimientos y preferencia vuelven a la transacción del alta:
    // se confirman con la cuenta o no queda nada (docs/prisma-migration.md, grupos 2, 3 y 6).
    it('registra los consentimientos DENTRO de la transacción del alta, con la política activa', async () => {
      armHappyRegister();
      const tx = { commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn() };
      prisma.$transaction.mockImplementation(managedTransaction(tx));

      await service.register(VALID_USER_DATA, { ip: '9.9.9.9' });

      expect(userConsentRepository.grant).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', consentTypeId: 'ct-1', privacyPolicyId: 'pp-1', ip: '9.9.9.9' })
      );
      expect(userConsentRepository.grant.mock.invocationCallOrder[0]).toBeLessThan(tx.commit.mock.invocationCallOrder[0]!);
    });

    it('crea la preferencia de notificación por defecto DENTRO de la transacción del alta', async () => {
      armHappyRegister();
      const tx = { commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn() };
      prisma.$transaction.mockImplementation(managedTransaction(tx));

      await service.register(VALID_USER_DATA, {});

      expect(userNotificationPreferenceRepository.upsert).toHaveBeenCalledWith('u-1', {
        allowPush: true,
        allowEmail: true,
        allowSms: true,
        quietHoursStart: null,
        quietHoursEnd: null
      });
      expect(userNotificationPreferenceRepository.upsert.mock.invocationCallOrder[0]).toBeLessThan(
        tx.commit.mock.invocationCallOrder[0]!
      );
    });

    it('si falla la preferencia por defecto, el alta se revierte', async () => {
      armHappyRegister();
      const tx = { commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn() };
      prisma.$transaction.mockImplementation(managedTransaction(tx));
      userNotificationPreferenceRepository.upsert.mockRejectedValue(new Error('db down'));

      await expect(service.register(VALID_USER_DATA, {})).rejects.toMatchObject({ statusCode: 500 });
      expect(tx.commit).not.toHaveBeenCalled();
      expect(JwtUtil.generateAccessToken).not.toHaveBeenCalled();
    });

    it('si falla el registro del consentimiento, el alta se revierte (sin constancia no hay cuenta)', async () => {
      armHappyRegister();
      const tx = { commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn() };
      prisma.$transaction.mockImplementation(managedTransaction(tx));
      userConsentRepository.grant.mockRejectedValue(new Error('db down'));

      await expect(service.register(VALID_USER_DATA, {})).rejects.toMatchObject({ statusCode: 500 });
      expect(tx.commit).not.toHaveBeenCalled();
      expect(logAudit).not.toHaveBeenCalledWith('USER_REGISTERED', expect.anything(), expect.anything(), expect.anything());
    });

    it('valida el género cuando se envía genderId', async () => {
      armHappyRegister();
      genderRepository.exists.mockResolvedValue(true);
      await service.register({ ...VALID_USER_DATA, genderId: 'g-1' }, {});
      expect(genderRepository.exists).toHaveBeenCalledWith({ genderId: 'g-1' });
    });
  });

  describe('register — prerrequisitos', () => {
    it('lanza internal si no hay política de privacidad activa', async () => {
      armHappyRegister();
      privacyPolicyRepository.findActive.mockResolvedValue(null);
      await expect(service.register(VALID_USER_DATA, {})).rejects.toMatchObject({ statusCode: 500 });
    });

    it('lanza internal si el país de operación no está configurado', async () => {
      armHappyRegister();
      countryRepository.findByCode.mockResolvedValue(null);
      await expect(service.register(VALID_USER_DATA, {})).rejects.toMatchObject({ statusCode: 500 });
    });

    it('lanza forbidden si el email no está verificado', async () => {
      armHappyRegister();
      verificationCodeRepository.findVerifiedByContact.mockResolvedValue(null);
      await expect(service.register(VALID_USER_DATA, {})).rejects.toMatchObject({ statusCode: 403 });
    });

    it('lanza notFound si el tipo de documento no existe o está inactivo', async () => {
      armHappyRegister();
      documentTypeRepository.findById.mockResolvedValue({ isActive: false });
      await expect(service.register(VALID_USER_DATA, {})).rejects.toMatchObject({ statusCode: 404 });
    });

    it('lanza forbidden si el tipo de documento no es visible al cliente', async () => {
      armHappyRegister();
      documentTypeRepository.findById.mockResolvedValue({ documentTypeId: 'dt-1', isActive: true, isVisibleToClient: false });
      await expect(service.register(VALID_USER_DATA, {})).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  describe('register — validación de unicidad', () => {
    it('lanza conflict si el email ya está registrado', async () => {
      armHappyRegister();
      personContactRepository.findByEmail.mockResolvedValue({ personContactId: 'x' });
      await expect(service.register(VALID_USER_DATA, {})).rejects.toMatchObject({ statusCode: 409 });
    });

    it('lanza conflict si el documento ya está registrado', async () => {
      armHappyRegister();
      personRepository.findByNationalId.mockResolvedValue({ personId: 'x' });
      await expect(service.register(VALID_USER_DATA, {})).rejects.toMatchObject({ statusCode: 409 });
    });

    it('lanza notFound si el género seleccionado no existe', async () => {
      armHappyRegister();
      genderRepository.exists.mockResolvedValue(false);
      await expect(service.register({ ...VALID_USER_DATA, genderId: 'g-x' }, {})).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('register — rollback de creación', () => {
    it('mapea un error NO operativo a internal tras el rollback de la transacción', async () => {
      armHappyRegister();
      const tx = { commit: jest.fn(), rollback: jest.fn().mockResolvedValue(undefined) };
      prisma.$transaction.mockImplementation(managedTransaction(tx));
      roleRepository.findByName.mockResolvedValue({ roleId: 'r' });
      personRepository.create.mockRejectedValue(new Error('db boom')); // error crudo, no operativo

      await expect(service.register(VALID_USER_DATA, {})).rejects.toMatchObject({ statusCode: 500 });
      expect(tx.rollback).toHaveBeenCalled();
    });

    it('propaga tal cual un error operativo (ej: rol CLIENTE ausente)', async () => {
      armHappyRegister();
      roleRepository.findByName.mockResolvedValue(null); // → AppError.internal operativo dentro de la tx
      await expect(service.register(VALID_USER_DATA, {})).rejects.toMatchObject({ statusCode: 500, isOperational: true });
    });
  });

  describe('requestResetCredentials — anti-enumeración', () => {
    it('devuelve false si el email no corresponde a un usuario', async () => {
      personContactRepository.findByEmailWithUser.mockResolvedValue(null);
      await expect(service.requestResetCredentials({ email: 'x@x.com', type: 'password' })).resolves.toBe(false);
      expect(credentialResetRepository.createResetToken).not.toHaveBeenCalled();
    });

    it('devuelve false si el usuario está inactivo', async () => {
      personContactRepository.findByEmailWithUser.mockResolvedValue({
        person: { firstName: 'Ada', user: { userId: 'u-1', isActive: false } }
      });
      await expect(service.requestResetCredentials({ email: 'x@x.com', type: 'password' })).resolves.toBe(false);
      expect(credentialResetRepository.createResetToken).not.toHaveBeenCalled();
    });

    it('genera y persiste el token, audita, notifica y devuelve true (password)', async () => {
      personContactRepository.findByEmailWithUser.mockResolvedValue({
        person: { firstName: 'Ada', user: { userId: 'u-1', isActive: true } }
      });
      credentialResetRepository.invalidateUserTokens.mockResolvedValue(1);
      credentialResetRepository.createResetToken.mockResolvedValue({});
      notifier.notifyEmail.mockResolvedValue(undefined);

      const result = await service.requestResetCredentials({ email: 'x@x.com', type: 'password' });

      expect(result).toBe(true);
      expect(credentialResetRepository.createResetToken).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', email: 'x@x.com', type: 'password' })
      );
      expect(logAudit).toHaveBeenCalledWith('CREDENTIALS_RESET_REQUESTED', expect.objectContaining({ actorId: 'u-1' }));

      await flush();
      expect(notifier.notifyEmail).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SOLICITUD_RESET_PASSWORD' })
      );
    });

    it('usa la plantilla de MFA cuando el tipo es mfa', async () => {
      personContactRepository.findByEmailWithUser.mockResolvedValue({
        person: { firstName: 'Ada', user: { userId: 'u-1', isActive: true } }
      });
      credentialResetRepository.invalidateUserTokens.mockResolvedValue(0);
      credentialResetRepository.createResetToken.mockResolvedValue({});
      notifier.notifyEmail.mockResolvedValue(undefined);

      await service.requestResetCredentials({ email: 'x@x.com', type: 'mfa' });
      await flush();
      expect(notifier.notifyEmail).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SOLICITUD_RESET_MFA' })
      );
    });
  });

  describe('confirmResetCredentials', () => {
    function txOk() {
      const tx = { commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn().mockResolvedValue(undefined) };
      prisma.$transaction.mockImplementation(managedTransaction(tx));
      return tx;
    }

    it('lanza badRequest si el token es inválido o expiró', async () => {
      credentialResetRepository.findValidTokenWithUser.mockResolvedValue(null);
      await expect(service.confirmResetCredentials({ token: 't', type: 'password', newPassword: 'x' })).rejects.toMatchObject({
        statusCode: 400
      });
    });

    it('lanza badRequest si el tipo del registro no coincide con el solicitado', async () => {
      credentialResetRepository.findValidTokenWithUser.mockResolvedValue({ type: 'mfa', user: { userId: 'u-1' } });
      await expect(service.confirmResetCredentials({ token: 't', type: 'password', newPassword: 'x' })).rejects.toMatchObject({
        statusCode: 400
      });
    });

    it('resetea la contraseña, commitea, audita e invalida sesiones', async () => {
      const tx = txOk();
      credentialResetRepository.findValidTokenWithUser.mockResolvedValue({
        credentialResetId: 'rc-1',
        type: 'password',
        user: { userId: 'u-1', person: { firstName: 'Ada', contact: { email: 'x@x.com' } } }
      });
      userRepository.updatePassword.mockResolvedValue(undefined);
      credentialResetRepository.markAsUsed.mockResolvedValue(true);
      TokenBlacklistUtil.invalidateUserSessions.mockResolvedValue(undefined);
      userSessionRepository.closeAllByUser.mockResolvedValue(undefined);
      notifier.notify.mockResolvedValue(undefined);

      const result = await service.confirmResetCredentials({ token: 't', type: 'password', newPassword: 'Nueva123!' });

      expect(userRepository.updatePassword).toHaveBeenCalledWith('u-1', 'Nueva123!');
      expect(tx.commit).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('PASSWORD_RESET_CONFIRMED', expect.objectContaining({ actorId: 'u-1' }));
      expect(TokenBlacklistUtil.invalidateUserSessions).toHaveBeenCalledWith('u-1');
      expect(result).toBeNull();
    });

    it('lanza badRequest si es reset de password sin newPassword y hace rollback', async () => {
      const tx = txOk();
      credentialResetRepository.findValidTokenWithUser.mockResolvedValue({
        credentialResetId: 'rc-1',
        type: 'password',
        user: { userId: 'u-1' }
      });
      await expect(service.confirmResetCredentials({ token: 't', type: 'password' })).rejects.toMatchObject({ statusCode: 400 });
      expect(tx.rollback).toHaveBeenCalled();
    });

    it('resetea el MFA (baja TOTP/SMS) y registra los cambios', async () => {
      txOk();
      credentialResetRepository.findValidTokenWithUser.mockResolvedValue({
        credentialResetId: 'rc-1',
        type: 'mfa',
        user: { userId: 'u-1', person: { firstName: 'Ada', contact: { email: 'x@x.com' } } }
      });
      userRepository.update.mockResolvedValue(undefined);
      KycSharedUtil.logChange.mockResolvedValue(undefined);
      credentialResetRepository.markAsUsed.mockResolvedValue(true);
      notifier.notify.mockResolvedValue(undefined);

      const result = await service.confirmResetCredentials({ token: 't', type: 'mfa' });

      expect(userRepository.update).toHaveBeenCalledWith(
        'u-1',
        expect.objectContaining({ totpEnabled: false, totpSecret: null, smsMfaEnabled: false, preferredMfaMethod: 'none' })
      );
      expect(KycSharedUtil.logChange).toHaveBeenCalledTimes(2);
      expect(logAudit).toHaveBeenCalledWith('MFA_RESET_CONFIRMED', expect.objectContaining({ actorId: 'u-1' }));
      // No se invalidan sesiones en reset de MFA (solo en password).
      expect(TokenBlacklistUtil.invalidateUserSessions).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('hace rollback y propaga si falla la aplicación del reset', async () => {
      const tx = txOk();
      credentialResetRepository.findValidTokenWithUser.mockResolvedValue({
        credentialResetId: 'rc-1',
        type: 'password',
        user: { userId: 'u-1' }
      });
      userRepository.updatePassword.mockRejectedValue(new Error('update fail'));
      await expect(service.confirmResetCredentials({ token: 't', type: 'password', newPassword: 'x' })).rejects.toThrow('update fail');
      expect(tx.rollback).toHaveBeenCalled();
    });
  });
});
