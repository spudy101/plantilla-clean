// tests/unit/modules/schemas/kyc/person/helpers/profile.helper.test.ts
//
// ProfileHelper recibe repositorios y KycSharedUtil por constructor (SOLID: D).
// Se prueba SIN jest.mock de repositorios: cada test arma sus fakes.


import { fixture } from 'tests/helpers/mock';
import profileHelperModule from './profile.helper';
const { ProfileHelper } = profileHelperModule;
import KycSharedUtil from '../utils/kyc-shared.util';

const AUDIT = { ip: '1.2.3.4', userAgent: 'jest' };

const makeHelper = (overrides = {}) => {
  const deps = {
    userRepository: { update: jest.fn().mockResolvedValue(undefined) },
    personRepository: { update: jest.fn().mockResolvedValue(undefined), findById: jest.fn() },
    personContactRepository: {
      findByEmail: jest.fn().mockResolvedValue(null),
      findByPrimaryPhone: jest.fn().mockResolvedValue(null),
      findBySecondaryPhone: jest.fn().mockResolvedValue(null),
      findByPersonId: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined)
    },
    personLocationRepository: {
      upsertByPersonId: jest.fn().mockResolvedValue(undefined),
      anonymizeAddressByPersonId: jest.fn().mockResolvedValue(undefined)
    },
    userConsentRepository: { revokeAll: jest.fn().mockResolvedValue(undefined) },
    verificationCodeRepository: {
      findVerifiedByContact: jest.fn().mockResolvedValue({ id: 'vc-1' }),
      deleteVerifiedByContact: jest.fn().mockResolvedValue(undefined)
    },
    departmentRepository: { findById: jest.fn() },
    cityRepository: { findById: jest.fn() },
    // Formateadores/validadores reales (puros, métodos estáticos); logChange falso porque escribe en BD
    kycSharedUtil: {
      formatDeletedNationalId: KycSharedUtil.formatDeletedNationalId,
      formatDeletedUsername: KycSharedUtil.formatDeletedUsername,
      formatDeletedEmail: KycSharedUtil.formatDeletedEmail,
      formatDeletedPhone: KycSharedUtil.formatDeletedPhone,
      validateNationalIdByRole: KycSharedUtil.validateNationalIdByRole,
      logChange: jest.fn().mockResolvedValue(undefined)
    },
    ...overrides
  };
  return { helper: new ProfileHelper(fixture(deps)), deps };
};

describe('ProfileHelper', () => {
  describe('validateEmailUnique', () => {
    it('lanza 409 si el email pertenece a otra persona', async () => {
      const { helper, deps } = makeHelper();
      deps.personContactRepository.findByEmail.mockResolvedValue({ personId: 'otra' });

      await expect(helper.validateEmailUnique('a@b.cl', 'p-1')).rejects.toMatchObject({ statusCode: 409 });
    });

    it('acepta el email si es de la misma persona', async () => {
      const { helper, deps } = makeHelper();
      deps.personContactRepository.findByEmail.mockResolvedValue({ personId: 'p-1' });

      await expect(helper.validateEmailUnique('a@b.cl', 'p-1')).resolves.toBe(true);
    });
  });

  describe('updateLocation', () => {
    it('valida la jerarquía antes de tocar la BD: ciudad de otro departamento → 400 sin upsert', async () => {
      const { helper, deps } = makeHelper();
      deps.departmentRepository.findById.mockResolvedValue({ departmentId: 'd-1' });
      deps.cityRepository.findById.mockResolvedValue({ cityId: 'c-1', departmentId: 'd-2' });

      await expect(helper.updateLocation('p-1', fixture({ departmentId: 'd-1', cityId: 'c-1' }))).rejects.toMatchObject({
        statusCode: 400
      });
      expect(deps.personLocationRepository.upsertByPersonId).not.toHaveBeenCalled();
    });

    it('ciudad del mismo departamento → pasa la validación y hace el upsert', async () => {
      const { helper, deps } = makeHelper();
      deps.departmentRepository.findById.mockResolvedValue({ departmentId: 'd-1' });
      deps.cityRepository.findById.mockResolvedValue({ cityId: 'c-1', departmentId: 'd-1' });
      deps.personLocationRepository.upsertByPersonId.mockResolvedValue({});

      await helper.updateLocation('p-1', fixture({ departmentId: 'd-1', cityId: 'c-1' })).catch(() => undefined);

      expect(deps.personLocationRepository.upsertByPersonId).toHaveBeenCalled();
    });
  });

  describe('updatePhoneLogic', () => {
    it('actualiza el contacto vía repositorio (no con la instancia ORM) y registra el cambio', async () => {
      const { helper, deps } = makeHelper();
      deps.personContactRepository.findByPersonId.mockResolvedValue({ personContactId: 'pc-1', phonePrimary: '900000000' });

      const result = await helper.updatePhoneLogic(
        fixture({
          personId: 'p-1',
          phone: '911112222',
          phonePrefixId: 'pp-1',
          phoneType: 'primary',
          userId: 'u-1',
          auditContext: AUDIT
        })
      );

      expect(deps.personContactRepository.update).toHaveBeenCalledWith(
        'pc-1',
        expect.objectContaining({ phonePrimary: '911112222', phonePrimaryPrefixId: 'pp-1' })
      );
      expect(deps.kycSharedUtil.logChange).toHaveBeenCalledWith(
        expect.objectContaining({ changeType: 'phone', previousValue: '900000000', newValue: '911112222' })
      );
      expect(result).toEqual({ phone: '911112222', phonePrefixId: 'pp-1', phoneType: 'primary' });
    });

    it('lanza 403 si el teléfono no fue verificado', async () => {
      const { helper, deps } = makeHelper();
      deps.verificationCodeRepository.findVerifiedByContact.mockResolvedValue(null);

      await expect(
        helper.updatePhoneLogic(fixture({ personId: 'p-1', phone: '911112222', phoneType: 'primary' }))
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(deps.personContactRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('updateNationalIdLogic', () => {
    it('es idempotente: mismo valor no actualiza ni audita', async () => {
      const { helper, deps } = makeHelper();
      deps.personRepository.findById.mockResolvedValue({ nationalId: '123' });

      const result = await helper.updateNationalIdLogic(fixture({ personId: 'p-1', newNationalId: '123', auditContext: AUDIT }));

      expect(result).toEqual({ oldNationalId: '123', newNationalId: '123', unchanged: true });
      expect(deps.personRepository.update).not.toHaveBeenCalled();
      expect(deps.kycSharedUtil.logChange).not.toHaveBeenCalled();
    });
  });

  describe('deleteAccountLogic', () => {
    it('ofusca datos, anonimiza la dirección vía repositorio y revoca consentimientos en la misma transacción', async () => {
      const { helper, deps } = makeHelper();
      deps.personContactRepository.findByPersonId.mockResolvedValue({ personContactId: 'pc-1', phonePrimary: '911112222' });

      const result = await helper.deleteAccountLogic(
        fixture({
          userId: 'u-1',
          personId: 'p-1',
          nationalId: '123',
          email: 'ana@b.cl',
          username: 'ana',
          firstName: 'Ana',
          auditContext: AUDIT
        })
      );

      expect(deps.personRepository.update).toHaveBeenCalledWith(
        'p-1',
        expect.objectContaining({ firstName: 'ELIMINADO', lastName: 'ELIMINADO' })
      );
      expect(deps.userRepository.update).toHaveBeenCalledWith(
        'u-1',
        expect.objectContaining({ isActive: false, deletedAt: expect.any(Date) })
      );
      expect(deps.personLocationRepository.anonymizeAddressByPersonId).toHaveBeenCalledWith('p-1');
      expect(deps.userConsentRepository.revokeAll).toHaveBeenCalledWith('u-1');
      expect(result).toMatchObject({ deletedEmail: 'ana@b.cl', firstName: 'Ana' });
    });
  });
});
