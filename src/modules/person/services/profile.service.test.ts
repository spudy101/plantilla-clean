// tests/unit/modules/shared-endpoints/kyc/person/services/profile.service.test.ts
//
// ProfileService — perfil del cliente (consulta + actualizaciones de username/avatar/genero/ubicacion/
// nombres/email/telefono/password + baja de cuenta). Aislamos repositorios, helper de perfil, util de
// trazabilidad, notificaciones y DTOs (passthrough). Probamos: consultas (found / notFound), cada
// mutacion (helper llamado + commit + logAudit + notificacion diferida en setImmediate + DTO), y las
// ramas de error (rollback + repropagacion). Se usa el
// AppError real para assertar statusCode. Las notificaciones fire-and-forget se vacian con `flush`.

jest.mock('../../../shared/infrastructure/database/prisma', () => ({ __esModule: true, default: { $transaction: jest.fn() } }));

jest.mock('../../iam/repositories/user.repository', () => ({ findByUserId: jest.fn() }));
jest.mock('../repositories/person.repository', () => ({ findById: jest.fn() }));
jest.mock('../../legal/infrastructure/persistence/prisma-user-consent.repository', () => ({ findCurrentByUser: jest.fn() }));
jest.mock('../../legal/infrastructure/persistence/prisma-consent-type.repository', () => ({ listActive: jest.fn() }));
jest.mock('../repositories/person-contact.repository', () => ({
  findByPersonIdWithPrefixes: jest.fn()
}));
jest.mock('../repositories/person-location.repository', () => ({ findByPersonId: jest.fn() }));

jest.mock('../../notification/notify', () => ({
  notify: jest.fn().mockResolvedValue(undefined),
  notifyEmail: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../utils/kyc-shared.util', () => ({ logChange: jest.fn().mockResolvedValue(undefined) }));

jest.mock('../helpers/profile.helper', () => ({
  fetchPersonSnapshot: jest.fn(),
  updateUsername: jest.fn().mockResolvedValue(undefined),
  updateAvatar: jest.fn().mockResolvedValue(undefined),
  updateGender: jest.fn().mockResolvedValue(undefined),
  updateLocation: jest.fn().mockResolvedValue(undefined),
  updateBirthDate: jest.fn().mockResolvedValue(undefined),
  updateNames: jest.fn().mockResolvedValue(undefined),
  validateCurrentPassword: jest.fn().mockResolvedValue(undefined),
  updateEmailLogic: jest.fn(),
  updatePhoneLogic: jest.fn(),
  updatePasswordLogic: jest.fn().mockResolvedValue(undefined),
  deleteAccountLogic: jest.fn()
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logAudit: jest.fn()
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

// DTOs passthrough: objetos etiquetados para verificar qué recibieron.
jest.mock('../responses/profile.response', () => ({
  BasicProfileDTO: jest.fn((...args) => ({ dto: 'basic', args })),
  ExtendedProfileDTO: jest.fn((...args) => ({ dto: 'extended', args })),
  UpdateEmailResponseDTO: jest.fn((newEmail, updatedAt) => ({ dto: 'email', newEmail, updatedAt })),
  UpdatePhoneResponseDTO: jest.fn((phone, phonePrefixId, phoneType, updatedAt) => ({
    dto: 'phone',
    phone,
    phonePrefixId,
    phoneType,
    updatedAt
  })),
  UpdateNamesResponseDTO: jest.fn(person => ({ dto: 'names', person }))
}));

// Componentes shared requeridos de forma diferida dentro de getContactInfo/getLocation.
jest.mock('../responses/person-components.response', () => ({
  PersonContactComponent: { build: jest.fn(c => ({ built: 'contact', c })) },
  PersonLocationComponent: { build: jest.fn(l => ({ built: 'location', l })) }
}));

import { managedTransaction } from 'tests/helpers/transaction';
import { mocked, Loose, fixture } from 'tests/helpers/mock';
import prismaModule from '../../../shared/infrastructure/database/prisma';
const prisma = mocked(prismaModule);
import userRepositoryModule from '../../iam/repositories/user.repository';
const userRepository = mocked(userRepositoryModule);
import personRepositoryModule from '../repositories/person.repository';
const personRepository = mocked(personRepositoryModule);
const userConsentRepositoryModule = jest.requireMock<import('../../legal/infrastructure/persistence/prisma-user-consent.repository').PrismaUserConsentRepository>('../../legal/infrastructure/persistence/prisma-user-consent.repository');
const userConsentRepository = mocked(userConsentRepositoryModule);
const consentTypeRepositoryModule = jest.requireMock<import('../../legal/infrastructure/persistence/prisma-consent-type.repository').PrismaConsentTypeRepository>('../../legal/infrastructure/persistence/prisma-consent-type.repository');
const consentTypeRepository = mocked(consentTypeRepositoryModule);
import personContactRepositoryModule from '../repositories/person-contact.repository';
const personContactRepository = mocked(personContactRepositoryModule);
import personLocationRepositoryModule from '../repositories/person-location.repository';
const personLocationRepository = mocked(personLocationRepositoryModule);
import NotificationUtilModule from '../../notification/notify';
const notifier = mocked(NotificationUtilModule);
import KycSharedUtilModule from '../utils/kyc-shared.util';
const KycSharedUtil = mocked(KycSharedUtilModule);
import ProfileHelperModule from '../helpers/profile.helper';
const ProfileHelper = mocked(ProfileHelperModule);
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;
import kycModule from '../responses/person-components.response';
const { PersonContactComponent, PersonLocationComponent } = mocked(kycModule);
import profileDtoModule from '../responses/profile.response';
const profileDto = mocked(profileDtoModule);
import service from './profile.service';

// Vacia la cola de macrotareas (setImmediate) para dejar correr las notificaciones fire-and-forget.
const flush = () =>
  new Promise(resolve => {
    setImmediate(resolve);
  });

function makeTransaction() {
  return {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    finished: false
  };
}

describe('ProfileService', () => {
  let transaction: Loose;

  beforeEach(() => {
    jest.clearAllMocks();
    transaction = makeTransaction();
    prisma.$transaction.mockImplementation(managedTransaction(transaction));
  });

  // ============================================================
  // CONSULTAS
  // ============================================================

  describe('getProfile', () => {
    it('usuario existente: arma BasicProfileDTO con consentimientos y audita', async () => {
      const user = { userId: 'u-1' };
      userRepository.findByUserId.mockResolvedValue(user);
      consentTypeRepository.listActive.mockResolvedValue(['ct']);
      userConsentRepository.findCurrentByUser.mockResolvedValue(['c']);

      const result = await service.getProfile('u-1');

      expect(userRepository.findByUserId).toHaveBeenCalledWith('u-1', 'basic');
      expect(profileDto.BasicProfileDTO).toHaveBeenCalledWith(user, ['ct'], ['c']);
      expect(logAudit).toHaveBeenCalledWith('PROFILE_VIEWED', expect.objectContaining({ actorId: 'u-1', entityId: 'u-1', entityType: 'User', entityTable: 'users' })
      );
      expect(result).toEqual({ dto: 'basic', args: [user, ['ct'], ['c']] });
    });

    it('usuario inexistente: lanza AppError.notFound (404)', async () => {
      userRepository.findByUserId.mockResolvedValue(null);

      await expect(service.getProfile('u-x')).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(profileDto.BasicProfileDTO).not.toHaveBeenCalled();
    });
  });

  describe('getExtendedProfile', () => {
    it('usuario existente: pide el user full y arma ExtendedProfileDTO', async () => {
      const user = { userId: 'u-1' };
      userRepository.findByUserId.mockResolvedValue(user);
      consentTypeRepository.listActive.mockResolvedValue([]);
      userConsentRepository.findCurrentByUser.mockResolvedValue([]);

      await service.getExtendedProfile('u-1');

      expect(userRepository.findByUserId).toHaveBeenCalledWith('u-1', 'full');
      expect(profileDto.ExtendedProfileDTO).toHaveBeenCalledWith(user, [], []);
      expect(logAudit).toHaveBeenCalledWith('PROFILE_EXTENDED_VIEWED', expect.objectContaining({ actorId: 'u-1' }));
    });

    it('usuario inexistente: lanza AppError.notFound', async () => {
      userRepository.findByUserId.mockResolvedValue(null);
      await expect(service.getExtendedProfile('u-x')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('getContactInfo', () => {
    it('contacto encontrado: construye el componente y audita', async () => {
      personContactRepository.findByPersonIdWithPrefixes.mockResolvedValue({ email: 'a@b.cl' });

      const result = await service.getContactInfo('p-1', 'u-1');

      expect(personContactRepository.findByPersonIdWithPrefixes).toHaveBeenCalledWith('p-1');
      expect(PersonContactComponent.build).toHaveBeenCalledWith({ email: 'a@b.cl' });
      expect(logAudit).toHaveBeenCalledWith('PROFILE_CONTACT_VIEWED', { actorId: 'u-1', details: { personId: 'p-1' }, entityId: 'u-1', entityType: 'User', entityTable: 'users' }
      );
      expect(result).toEqual({ built: 'contact', c: { email: 'a@b.cl' } });
    });

    it('sin contacto: lanza AppError.notFound', async () => {
      personContactRepository.findByPersonIdWithPrefixes.mockResolvedValue(null);
      await expect(service.getContactInfo('p-1', 'u-1')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('getLocation', () => {
    it('construye el componente de ubicacion y audita', async () => {
      personLocationRepository.findByPersonId.mockResolvedValue({ cityId: 3 });

      const result = await service.getLocation('p-1', 'u-1');

      expect(PersonLocationComponent.build).toHaveBeenCalledWith({ cityId: 3 });
      expect(logAudit).toHaveBeenCalledWith('PROFILE_LOCATION_VIEWED', expect.objectContaining({ actorId: 'u-1', details: { personId: 'p-1' } }));
      expect(result).toEqual({ built: 'location', l: { cityId: 3 } });
    });
  });

  // ============================================================
  // ACTUALIZACIONES
  // ============================================================

  describe('updateProfile', () => {
    it('camino feliz: aplica cada campo, registra cambios, commitea, audita, notifica y devuelve DTO', async () => {
      ProfileHelper.fetchPersonSnapshot.mockResolvedValue({ genderId: null, birthDate: null, location: null });
      const updatedUser = { userId: 'u-1' };
      // 1a llamada snapshot ya cubierta; findByUserId('u-1','full') devuelve el user actualizado.
      userRepository.findByUserId.mockResolvedValue(updatedUser);

      const data = {
        username: 'nuevo',
        avatarId: 'av-1',
        genderId: 'g-1',
        location: { cityId: 5 },
        birthDate: '1990-01-01'
      };

      const result = await service.updateProfile(fixture(data), 'u-1', 'p-1', 'viejo', 'Ana', { ip: '1.1.1.1' });

      expect(ProfileHelper.updateUsername).toHaveBeenCalledWith('u-1', 'nuevo');
      expect(ProfileHelper.updateAvatar).toHaveBeenCalledWith('u-1', 'av-1');
      expect(ProfileHelper.updateGender).toHaveBeenCalledWith('p-1', 'g-1');
      expect(ProfileHelper.updateLocation).toHaveBeenCalledWith('p-1', { cityId: 5 });
      expect(ProfileHelper.updateBirthDate).toHaveBeenCalledWith('p-1', '1990-01-01');
      // _logProfileFieldChanges: gender + birth_date + location => 3 registros de cambio.
      expect(KycSharedUtil.logChange).toHaveBeenCalledTimes(3);
      expect(transaction.commit).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('PROFILE_UPDATED', expect.objectContaining({ actorId: 'u-1', details: { updatedFields: ['username', 'avatarId', 'genderId', 'location', 'birthDate'] } })
      );

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PROFILE_UPDATED', userId: 'u-1', metadata: { nombre: 'Ana' } })
      );
      expect(result).toEqual({ dto: 'extended', args: [updatedUser] });
    });

    it('no toca el username si es igual al actual', async () => {
      ProfileHelper.fetchPersonSnapshot.mockResolvedValue({});
      userRepository.findByUserId.mockResolvedValue({});

      await service.updateProfile({ username: 'mismo' }, 'u-1', 'p-1', 'mismo', 'Ana');

      expect(ProfileHelper.updateUsername).not.toHaveBeenCalled();
      expect(transaction.commit).toHaveBeenCalled();
    });

    it('si un helper falla: rollback y repropaga sin commitear', async () => {
      ProfileHelper.fetchPersonSnapshot.mockResolvedValue({});
      const boom = new Error('helper boom');
      ProfileHelper.updateAvatar.mockRejectedValueOnce(boom);

      await expect(service.updateProfile({ avatarId: 'av-1' }, 'u-1', 'p-1', 'x', 'Ana')).rejects.toBe(boom);
      expect(transaction.rollback).toHaveBeenCalled();
      expect(transaction.commit).not.toHaveBeenCalled();
    });
  });

  describe('updateEmail', () => {
    it('camino feliz: valida password, actualiza, commitea, audita, notifica y devuelve DTO', async () => {
      userRepository.findByUserId.mockResolvedValue({ passwordHash: 'hash' });
      ProfileHelper.updateEmailLogic.mockResolvedValue({ newEmail: 'nuevo@b.cl' });

      const result = await service.updateEmail(
        { email: 'nuevo@b.cl', currentPassword: 'pass' },
        'u-1',
        'p-1',
        'Ana',
        { ip: '1.1.1.1' }
      );

      expect(userRepository.findByUserId).toHaveBeenCalledWith('u-1', 'minimal');
      expect(ProfileHelper.validateCurrentPassword).toHaveBeenCalledWith('hash', 'pass');
      expect(ProfileHelper.updateEmailLogic).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', personId: 'p-1', newEmail: 'nuevo@b.cl', changedByRole: 'user' })
      );
      expect(transaction.commit).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('PROFILE_EMAIL_UPDATED', expect.objectContaining({ actorId: 'u-1', details: { newEmail: 'nuevo@b.cl' } }));

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'EMAIL_UPDATED' })
      );
      expect(result).toMatchObject({ dto: 'email', newEmail: 'nuevo@b.cl' });
    });

    it('usuario inexistente: lanza notFound antes de abrir transaccion', async () => {
      userRepository.findByUserId.mockResolvedValue(null);

      await expect(
        service.updateEmail({ email: 'x@b.cl', currentPassword: 'p' }, 'u-x', 'p-1', 'Ana', {})
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('si updateEmailLogic falla: rollback y repropaga', async () => {
      userRepository.findByUserId.mockResolvedValue({ passwordHash: 'hash' });
      const boom = new Error('email boom');
      ProfileHelper.updateEmailLogic.mockRejectedValue(boom);

      await expect(
        service.updateEmail({ email: 'x@b.cl', currentPassword: 'p' }, 'u-1', 'p-1', 'Ana', {})
      ).rejects.toBe(boom);
      expect(transaction.rollback).toHaveBeenCalled();
    });
  });

  describe('updatePhone', () => {
    it('camino feliz: actualiza telefono, commitea, audita, notifica y devuelve DTO', async () => {
      ProfileHelper.updatePhoneLogic.mockResolvedValue({ phone: '911112222', phonePrefixId: 'pp-1', phoneType: 'mobile' });

      const result = await service.updatePhone(
        fixture({ newPhone: '911112222', phonePrefixId: 'pp-1', phoneType: 'mobile' }),
        'u-1',
        'p-1',
        'Ana',
        {}
      );

      expect(ProfileHelper.updatePhoneLogic).toHaveBeenCalledWith(
        expect.objectContaining({ personId: 'p-1', phone: '911112222', phonePrefixId: 'pp-1', phoneType: 'mobile' })
      );
      expect(transaction.commit).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('PROFILE_PHONE_UPDATED', expect.objectContaining({ actorId: 'u-1', details: { phoneType: 'mobile' } }));

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PHONE_UPDATED' })
      );
      expect(result).toMatchObject({ dto: 'phone', phone: '911112222', phoneType: 'mobile' });
    });

    it('si updatePhoneLogic falla: rollback y repropaga', async () => {
      const boom = new Error('phone boom');
      ProfileHelper.updatePhoneLogic.mockRejectedValue(boom);

      await expect(service.updatePhone(fixture({ newPhone: '9' }), 'u-1', 'p-1', 'Ana', {})).rejects.toBe(boom);
      expect(transaction.rollback).toHaveBeenCalled();
    });
  });

  describe('updatePassword', () => {
    it('camino feliz: valida, actualiza, commitea, audita, notifica y devuelve null', async () => {
      userRepository.findByUserId.mockResolvedValue({ passwordHash: 'hash' });

      const result = await service.updatePassword(
        { currentPassword: 'old', newPassword: 'new' },
        'u-1',
        'Ana',
        {}
      );

      expect(ProfileHelper.validateCurrentPassword).toHaveBeenCalledWith('hash', 'old');
      expect(ProfileHelper.updatePasswordLogic).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', newPassword: 'new', changedByRole: 'user' })
      );
      expect(transaction.commit).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('PASSWORD_CHANGED', expect.objectContaining({ actorId: 'u-1' }));

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PASSWORD_UPDATED' })
      );
      expect(result).toBeNull();
    });

    // InvalidPasswordException era un error de Cognito (código residual eliminado): cualquier error
    // del helper se repropaga tal cual tras el rollback.
    it('error del helper: rollback y repropaga el error original', async () => {
      userRepository.findByUserId.mockResolvedValue({ passwordHash: 'hash' });
      const err = new Error('weak');
      err.name = 'InvalidPasswordException';
      ProfileHelper.updatePasswordLogic.mockRejectedValue(err);

      await expect(
        service.updatePassword({ currentPassword: 'old', newPassword: 'weak' }, 'u-1', 'Ana', {})
      ).rejects.toBe(err);
      expect(transaction.rollback).toHaveBeenCalled();
    });
  });

  describe('updateNames', () => {
    it('con cambio de nombre: registra el cambio, commitea, audita, notifica y devuelve DTO', async () => {
      const before = { firstName: 'Ana', lastName: 'Perez' };
      const after = { personId: 'p-1', firstName: 'Ana Maria', lastName: 'Perez' };
      personRepository.findById.mockResolvedValueOnce(before).mockResolvedValueOnce(after);

      const result = await service.updateNames({ firstName: 'Ana Maria' }, 'u-1', 'p-1', 'Ana', { ip: '1.1.1.1' });

      expect(ProfileHelper.updateNames).toHaveBeenCalledWith('p-1', {
        firstName: 'Ana Maria',
        middleName: undefined,
        lastName: undefined,
        secondLastName: undefined
      });
      expect(KycSharedUtil.logChange).toHaveBeenCalledWith(
        expect.objectContaining({ changeType: 'name', previousValue: 'Ana Perez', newValue: 'Ana Maria Perez' })
      );
      expect(transaction.commit).toHaveBeenCalled();

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PROFILE_UPDATED' })
      );
      expect(result).toEqual({ dto: 'names', person: after });
    });

    it('sin cambio de nombre: NO registra cambio pero igual commitea', async () => {
      const person = { personId: 'p-1', firstName: 'Ana', lastName: 'Perez' };
      personRepository.findById.mockResolvedValue(person);

      await service.updateNames({ firstName: 'Ana', lastName: 'Perez' }, 'u-1', 'p-1', 'Ana', {});

      expect(KycSharedUtil.logChange).not.toHaveBeenCalled();
      expect(transaction.commit).toHaveBeenCalled();
    });

    it('si updateNames falla: rollback y repropaga', async () => {
      personRepository.findById.mockResolvedValue({ firstName: 'Ana', lastName: 'Perez' });
      const boom = new Error('names boom');
      ProfileHelper.updateNames.mockRejectedValue(boom);

      await expect(service.updateNames({ firstName: 'X' }, 'u-1', 'p-1', 'Ana', {})).rejects.toBe(boom);
      expect(transaction.rollback).toHaveBeenCalled();
    });
  });

  describe('deleteAccount', () => {
    it('camino feliz: valida, elimina, commitea, audita, notifica al email eliminado y devuelve null', async () => {
      userRepository.findByUserId.mockResolvedValue({ passwordHash: 'hash', username: 'ana' });
      ProfileHelper.deleteAccountLogic.mockResolvedValue({ deletedEmail: 'ana@b.cl', firstName: 'Ana' });

      const result = await service.deleteAccount(
        { currentPassword: 'pass' },
        { userId: 'u-1', personId: 'p-1', nationalId: '111', email: 'ana@b.cl', firstName: 'Ana', auditContext: {} }
      );

      expect(ProfileHelper.validateCurrentPassword).toHaveBeenCalledWith('hash', 'pass');
      expect(ProfileHelper.deleteAccountLogic).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', personId: 'p-1', username: 'ana', changedByRole: 'user' })
      );
      expect(transaction.commit).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('ACCOUNT_DELETED', expect.objectContaining({ actorId: 'u-1' }));

      await flush();
      expect(notifier.notifyEmail).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CUENTA_ELIMINADA', email: 'ana@b.cl' })
      );
      expect(result).toBeNull();
    });

    it('sin deletedEmail: no envia notificacion directa', async () => {
      userRepository.findByUserId.mockResolvedValue({ passwordHash: 'hash' });
      ProfileHelper.deleteAccountLogic.mockResolvedValue({ deletedEmail: null });

      await service.deleteAccount(
        { currentPassword: 'pass' },
        fixture({ userId: 'u-1', personId: 'p-1', auditContext: {} })
      );

      await flush();
      expect(notifier.notifyEmail).not.toHaveBeenCalled();
    });

    it('si deleteAccountLogic falla y la tx no termino: rollback y repropaga', async () => {
      userRepository.findByUserId.mockResolvedValue({ passwordHash: 'hash' });
      const boom = new Error('delete boom');
      ProfileHelper.deleteAccountLogic.mockRejectedValue(boom);

      await expect(
        service.deleteAccount({ currentPassword: 'pass' }, fixture({ userId: 'u-1', personId: 'p-1', auditContext: {} }))
      ).rejects.toBe(boom);
      expect(transaction.rollback).toHaveBeenCalled();
    });
  });
});
