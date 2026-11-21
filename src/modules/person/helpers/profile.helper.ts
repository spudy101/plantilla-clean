import type { Person, PersonContact } from '../../../shared/infrastructure/database/generated/prisma/client';
import type * as Types from './profile.types';
import iamModule from '../../iam';
const { userRepository } = iamModule;
import personRepository from '../repositories/person.repository';
import personContactRepository from '../repositories/person-contact.repository';
import personLocationRepository from '../repositories/person-location.repository';
import legalModule from '../../legal';
const { userConsentRepository } = legalModule;
import catalogsModule from '../../catalogs';
const { avatarRepository, genderRepository, documentTypeRepository, departmentRepository, cityRepository } = catalogsModule;
import notificationModule from '../../notification';
const { verificationCodeRepository } = notificationModule;
import KycSharedUtil from '../utils/kyc-shared.util';
import AppError from '../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;

/**
 * ============================================================
 * PROFILE HELPER
 * ============================================================
 * Operaciones reutilizables sobre el perfil (persona, contacto, ubicación, usuario)
 * compartidas entre ProfileService y los services admin que gestionan perfiles.
 * Nunca contiene lógica de negocio propia de un módulo específico.
 *
 * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones reales:
 *   new ProfileHelper({ personContactRepository: fake })
 */
class ProfileHelper {
  userRepository: typeof userRepository;
  personRepository: typeof personRepository;
  personContactRepository: typeof personContactRepository;
  personLocationRepository: typeof personLocationRepository;
  userConsentRepository: typeof userConsentRepository;
  avatarRepository: typeof avatarRepository;
  genderRepository: typeof genderRepository;
  documentTypeRepository: typeof documentTypeRepository;
  verificationCodeRepository: typeof verificationCodeRepository;
  departmentRepository: typeof departmentRepository;
  cityRepository: typeof cityRepository;
  kycSharedUtil: typeof KycSharedUtil;

  /** @param {object} [deps] */
  constructor(deps: ProfileHelper.Deps = {}) {
    this.userRepository = deps.userRepository ?? userRepository;
    this.personRepository = deps.personRepository ?? personRepository;
    this.personContactRepository = deps.personContactRepository ?? personContactRepository;
    this.personLocationRepository = deps.personLocationRepository ?? personLocationRepository;
    this.userConsentRepository = deps.userConsentRepository ?? userConsentRepository;
    this.avatarRepository = deps.avatarRepository ?? avatarRepository;
    this.genderRepository = deps.genderRepository ?? genderRepository;
    this.documentTypeRepository = deps.documentTypeRepository ?? documentTypeRepository;
    this.verificationCodeRepository = deps.verificationCodeRepository ?? verificationCodeRepository;
    this.departmentRepository = deps.departmentRepository ?? departmentRepository;
    this.cityRepository = deps.cityRepository ?? cityRepository;
    this.kycSharedUtil = deps.kycSharedUtil ?? KycSharedUtil;
  }

  // ============================================================
  // VALIDACIONES
  // ============================================================

  /**
   * Valida la contraseña actual del usuario.
   * @throws {AppError} Si no coincide
   */
  async validateCurrentPassword(passwordHash: string | null, currentPassword: string) {
    const isValid = await this.userRepository.verifyPassword(currentPassword, passwordHash);
    if (!isValid) {
      throw AppError.badRequest('Contraseña actual incorrecta');
    }
    return true;
  }

  /**
   * Valida que el email esté verificado (código OTP confirmado en verification_codes).
   * @throws {AppError} Si no está verificado
   */
  async checkEmailVerified(email: string) {
    const verificationCode = await this.verificationCodeRepository.findVerifiedByContact('email', email);
    if (!verificationCode) {
      throw AppError.forbidden('El email debe estar verificado antes de poder actualizarlo');
    }
    return true;
  }

  /**
   * Valida que el teléfono esté verificado (código OTP confirmado en verification_codes).
   * @throws {AppError} Si no está verificado
   */
  async checkPhoneVerified(phone: string) {
    const verificationCode = await this.verificationCodeRepository.findVerifiedByContact('phone', phone);
    if (!verificationCode) {
      throw AppError.forbidden('El teléfono debe estar verificado antes de poder actualizarlo');
    }
    return true;
  }

  /**
   * Valida que el email sea único en el sistema.
   * @param {string} email
   * @param {string|null} excludePersonId - Excluir este personId del chequeo (para el propio usuario)
   * @throws {AppError} Si ya existe
   */
  async validateEmailUnique(email: string, excludePersonId: string | null = null) {
    const existingContact = await this.personContactRepository.findByEmail(email);
    if (existingContact && existingContact.personId !== excludePersonId) {
      throw AppError.conflict('El email ya está en uso por otro usuario');
    }
    return true;
  }

  /**
   * Valida que el teléfono no esté en uso por otro usuario.
   * Chequea tanto teléfono primario como secundario.
   * @throws {AppError} Si ya existe
   */
  async validatePhoneNotInUse(phone: string, excludePersonId: string, _phoneType?: ProfileHelper.PhoneType) {
    const existingPrimary = await this.personContactRepository.findByPrimaryPhone(phone);
    if (existingPrimary && existingPrimary.personId !== excludePersonId) {
      throw AppError.conflict('El teléfono ya está en uso por otro usuario');
    }

    const existingSecondary = await this.personContactRepository.findBySecondaryPhone(phone);
    if (existingSecondary && existingSecondary.personId !== excludePersonId) {
      throw AppError.conflict('El teléfono ya está en uso por otro usuario');
    }

    return true;
  }

  /**
   * Valida que el nationalId sea único en el sistema.
   * @throws {AppError} Si ya existe
   */
  async validateNationalIdUnique(nationalId: string, excludePersonId: string | null = null) {
    const existingPerson = await this.personRepository.findByNationalId(nationalId);
    if (existingPerson && existingPerson.personId !== excludePersonId) {
      throw AppError.conflict('El National ID ya está registrado');
    }
    return true;
  }

  /**
   * Valida que el username sea único en el sistema.
   * @throws {AppError} Si ya existe
   */
  async validateUsernameUnique(username: string, excludeUserId: string | null = null) {
    const existingUser = await this.userRepository.findByUsername(username);
    if (existingUser && existingUser.userId !== excludeUserId) {
      throw AppError.conflict('El username ya está en uso');
    }
    return true;
  }

  /**
   * Valida que un avatar exista y esté activo.
   * @throws {AppError} Si no existe o está inactivo
   */
  async validateAvatarExists(avatarId: string) {
    const avatar = await this.avatarRepository.findById(avatarId);
    if (!avatar) {
      throw AppError.notFound('Avatar no encontrado');
    }
    if (!avatar.isActive) {
      throw AppError.badRequest('Avatar no disponible');
    }
    return true;
  }

  /**
   * Valida que un género exista y esté activo.
   * @throws {AppError} Si no existe o está inactivo
   */
  async validateGenderExists(genderId: string) {
    const gender = await this.genderRepository.findById(genderId);
    if (!gender) {
      throw AppError.notFound('Gender no encontrado');
    }
    if (!gender.isActive) {
      throw AppError.badRequest('Gender no disponible');
    }
    return true;
  }

  /**
   * Valida que el tipo de documento exista y esté activo.
   * @throws {AppError} Si no existe o está inactivo
   */
  async validateDocumentTypeExists(documentTypeId: string) {
    const documentType = await this.documentTypeRepository.findById(documentTypeId);
    if (!documentType) {
      throw AppError.notFound('Tipo de documento no encontrado');
    }
    if (!documentType.isActive) {
      throw AppError.badRequest('Tipo de documento no disponible');
    }
    return true;
  }

  // ============================================================
  // SNAPSHOT — valores previos para auditoría
  // ============================================================

  async fetchPersonSnapshot(personId: string) {
    const [person, location] = await Promise.all([
      this.personRepository.findById(personId),
      this.personLocationRepository.findByPersonId(personId)
    ]);

    return {
      genderId: person?.genderId ?? null,
      birthDate: person?.birthDate ?? null,
      location: location
        ? {
            departmentId: location.departmentId,
            cityId: location.cityId,
            postalCode: location.postalCode,
            type: location.type,
            address: location.address ?? null
          }
        : null
    };
  }

  // ============================================================
  // ACTUALIZACIONES SIMPLES
  // ============================================================

  /**
   * Actualiza el username del usuario, validando unicidad.
   */
  async updateUsername(userId: string, newUsername: string) {
    await this.validateUsernameUnique(newUsername, userId);
    await this.userRepository.update(userId, { username: newUsername });
  }

  /**
   * Actualiza el avatar del usuario, validando que exista.
   */
  async updateAvatar(userId: string, avatarId: string) {
    await this.validateAvatarExists(avatarId);
    await this.userRepository.update(userId, { avatarId: avatarId });
  }

  /**
   * Actualiza el género de la persona, validando que exista.
   */
  async updateGender(personId: string, genderId: string) {
    await this.validateGenderExists(genderId);
    await this.personRepository.update(personId, { genderId: genderId });
  }

  /**
   * Valida que país, departamento y ciudad existan y sean consistentes entre sí.
   * @throws {AppError} Si alguno no existe o la jerarquía no es correcta
   */
  async validateLocationHierarchy({ countryId: _countryId, departmentId, cityId }: ProfileHelper.LocationInput) {
    const department = await this.departmentRepository.findById(departmentId);
    if (!department) {
      throw AppError.notFound('El departamento especificado no existe');
    }

    const city = await this.cityRepository.findById(cityId);
    if (!city) {
      throw AppError.notFound('La ciudad especificada no existe');
    }
    if (city.departmentId !== departmentId) {
      throw AppError.badRequest('La ciudad no pertenece al departamento especificado');
    }
  }

  /**
   * Upsert de la ubicación de una persona.
   */
  async updateLocation(personId: string, locationData: ProfileHelper.LocationInput) {
    await this.validateLocationHierarchy(locationData); // 👈 validar antes de tocar la BD

    const mappedData = {
      departmentId: locationData.departmentId,
      cityId: locationData.cityId,
      postalCode: locationData.postalCode,
      type: locationData.type,
      // address es NOT NULL y el validator la exige
      address: locationData.address
    };

    await this.personLocationRepository.upsertByPersonId(personId, mappedData);
  }

  /**
   * Actualiza la fecha de nacimiento de la persona.
   */
  async updateBirthDate(personId: string, birthDate: string) {
    await this.personRepository.update(personId, { birthDate: birthDate });
  }

  /**
   * Actualiza los nombres de la persona (primer/segundo nombre, primer/segundo apellido).
   * `firstName` y `lastName` son obligatorios; `middleName` y `secondLastName` aceptan null para limpiarse.
   * Solo incluye en el update las claves presentes en `fields`.
   */
  async updateNames(personId: string, fields: ProfileHelper.NamesInput) {
    const { firstName, middleName, lastName, secondLastName } = fields;
    const update: Partial<Person> = {};

    if (firstName !== undefined) {
      update.firstName = firstName;
    }
    if (lastName !== undefined) {
      update.lastName = lastName;
    }
    if (middleName !== undefined) {
      update.middleName = middleName === '' ? null : middleName;
    }
    if (secondLastName !== undefined) {
      update.secondLastName = secondLastName === '' ? null : secondLastName;
    }

    await this.personRepository.update(personId, update);
    return update;
  }

  /**
   * Prepara el objeto de campos para actualizar el teléfono en personContact.
   * @param {'primary'|'secondary'} phoneType
   */
  preparePhoneUpdateData(phone: string, phonePrefixId: string, phoneType: ProfileHelper.PhoneType): Partial<PersonContact> {
    if (phoneType === 'primary') {
      return {
        phonePrimary: phone,
        phonePrimaryPrefixId: phonePrefixId,
        phonePrimaryVerifiedAt: new Date()
      };
    }
    return {
      phoneSecondary: phone,
      phoneSecondaryPrefixId: phonePrefixId,
      phoneSecondaryVerifiedAt: new Date()
    };
  }

  // ============================================================
  // ACTUALIZACIONES COMPLEJAS
  // ============================================================

  /**
   * Lógica completa de actualización de email.
   * Actualiza BD y retorna los datos del cambio.
   *
   * @param {Object} params
   * @param {string}  params.userId
   * @param {string}  params.personId
   * @param {string}  params.newEmail
   * @param {string}  params.changedByUserId
   * @param {string}  params.changedByRole
   * @param {string}  params.changeReason
   * @param {Object}  params.auditContext
   * @param {boolean} params.skipVerificationCheck - true cuando lo hace un admin
   * @returns {Promise<{ oldEmail, newEmail }>}
   */
  async updateEmailLogic(params: ProfileHelper.UpdateEmailParams) {
    const {
      userId,
      personId,
      newEmail,
      changedByUserId,
      changedByRole,
      changeReason,
      auditContext,
      skipVerificationCheck = false
    } = params;

    if (!skipVerificationCheck) {
      await this.checkEmailVerified(newEmail);
    }

    await this.validateEmailUnique(newEmail, personId);

    const personContact = await this._requireContact(personId);
    const oldEmail = personContact.email;

    if (oldEmail === newEmail) {
      throw AppError.badRequest('El nuevo email es igual al actual');
    }

    await this.personContactRepository.update(personContact.personContactId, { email: newEmail, emailVerifiedAt: new Date() });

    await this.kycSharedUtil.logChange({
      userId,
      changedByUserId,
      changedByRole,
      changeType: 'email',
      previousValue: oldEmail,
      newValue: newEmail,
      changeReason,
      ipAddress: auditContext.ip || auditContext.ipAddress,
      userAgent: auditContext.userAgent
    });

    // Limpiar el código verificado — ya fue consumido
    if (!skipVerificationCheck) {
      setImmediate(() => {
        this.verificationCodeRepository.deleteVerifiedByContact('email', newEmail).catch(err =>
          logger.warn('Error limpiando verification_code de email', {
            error: err.message
          })
        );
      });
    }

    return { oldEmail, newEmail };
  }

  /**
   * Lógica completa de actualización de teléfono.
   * Valida verificación OTP y unicidad antes de actualizar.
   *
   * @returns {Promise<{ phone, phonePrefixId, phoneType }>}
   */
  async updatePhoneLogic(params: ProfileHelper.UpdatePhoneParams) {
    const { personId, phone, phonePrefixId, phoneType } = params;
    const { userId, changedByUserId, changedByRole, auditContext } = params;

    await this.checkPhoneVerified(phone);
    await this.validatePhoneNotInUse(phone, personId, phoneType);

    const personContact = await this._requireContact(personId);
    const oldPhone = phoneType === 'primary' ? personContact.phonePrimary : personContact.phoneSecondary;

    const updateData = this.preparePhoneUpdateData(phone, phonePrefixId, phoneType);
    await this.personContactRepository.update(personContact.personContactId, updateData);

    if (userId) {
      await this.kycSharedUtil.logChange({
        userId,
        changedByUserId: changedByUserId ?? userId,
        changedByRole: changedByRole ?? 'user',
        changeType: 'phone',
        previousValue: oldPhone ?? null,
        newValue: phone,
        changeReason: `Teléfono ${phoneType} actualizado`,
        ipAddress: auditContext?.ip || auditContext?.ipAddress || null,
        userAgent: auditContext?.userAgent || null
      });
    }

    // Limpiar el código verificado — ya fue consumido
    setImmediate(() => {
      this.verificationCodeRepository.deleteVerifiedByContact('phone', phone).catch(err =>
        logger.warn('Error limpiando verification_code de phone', {
          error: err.message,
          phone
        })
      );
    });

    return { phone, phonePrefixId, phoneType };
  }

  /**
   * Lógica completa de actualización de contraseña.
   * Persiste la nueva contraseña (bcrypt) en BD y registra el cambio.
   */
  async updatePasswordLogic(params: ProfileHelper.UpdatePasswordParams) {
    const { userId, newPassword, changedByUserId, changedByRole, changeReason, auditContext } = params;

    await this.userRepository.updatePassword(userId, newPassword);

    await this.kycSharedUtil.logChange({
      userId,
      changedByUserId,
      changedByRole,
      changeType: 'password',
      previousValue: 'hidden',
      newValue: 'hidden',
      changeReason,
      ipAddress: auditContext.ip || auditContext.ipAddress,
      userAgent: auditContext.userAgent
    });
  }

  /**
   * Lógica completa de actualización de nationalId.
   * Actualiza BD y registra el cambio.
   *
   * @returns {Promise<{ oldNationalId, newNationalId }>}
   */
  async updateNationalIdLogic(params: ProfileHelper.UpdateNationalIdParams) {
    const { userId, personId, newNationalId, documentTypeId, role, changedByUserId, changedByRole, changeReason, auditContext } =
      params;

    const person = await this.personRepository.findById(personId);
    if (!person) {
      throw AppError.notFound('Persona no encontrada');
    }
    const oldNationalId = person.nationalId;

    // Idempotente: si el valor no cambió, no se toca la BD ni se audita el cambio.
    if (oldNationalId === newNationalId) {
      return { oldNationalId, newNationalId, unchanged: true };
    }

    this.kycSharedUtil.validateNationalIdByRole(newNationalId, role);
    await this.validateNationalIdUnique(newNationalId, personId);

    // Si se envía el tipo de documento, validar que exista y esté activo antes de persistir.
    const personUpdate: Partial<Person> = { nationalId: newNationalId };
    if (documentTypeId) {
      await this.validateDocumentTypeExists(documentTypeId);
      personUpdate.documentTypeId = documentTypeId;
    }

    await this.personRepository.update(personId, personUpdate);

    await this.kycSharedUtil.logChange({
      userId,
      changedByUserId,
      changedByRole,
      changeType: 'national_id',
      previousValue: oldNationalId,
      newValue: newNationalId,
      changeReason,
      ipAddress: auditContext.ip || auditContext.ipAddress,
      userAgent: auditContext.userAgent
    });

    return { oldNationalId, newNationalId, unchanged: false };
  }

  /**
   * Lógica completa de eliminación de cuenta.
   * Ofusca los datos de la cuenta en BD.
   *
   * @returns {Promise<{ deletedEmail, deletedNationalId, firstName }>}
   */
  async deleteAccountLogic(params: ProfileHelper.DeleteAccountParams) {
    const {
      userId,
      personId,
      nationalId,
      email,
      username,
      firstName,
      changedByUserId,
      changedByRole,
      changeReason,
      auditContext
    } = params;

    const personContact = await this._requireContact(personId);

    const newNationalId = this.kycSharedUtil.formatDeletedNationalId(nationalId);
    const newUsername = this.kycSharedUtil.formatDeletedUsername(username);
    const newEmail = this.kycSharedUtil.formatDeletedEmail(email);

    const contactUpdates: Partial<PersonContact> = { email: newEmail };
    if (personContact.phonePrimary) {
      contactUpdates.phonePrimary = this.kycSharedUtil.formatDeletedPhone(personContact.phonePrimary);
    }
    if (personContact.phoneSecondary) {
      contactUpdates.phoneSecondary = this.kycSharedUtil.formatDeletedPhone(personContact.phoneSecondary);
    }

    await this.personRepository.update(personId, {
      nationalId: newNationalId,
      nationalIdHash: '0'.repeat(64),
      firstName: 'ELIMINADO',
      lastName: 'ELIMINADO',
      middleName: null,
      secondLastName: null,
      birthDate: null
    });

    // Marca la cuenta como eliminada: ofusca el username, la desactiva y sella deleted_at
    // (marcador irreversible que distingue "eliminado" de "desactivado" y la vuelve intocable).
    await this.userRepository.update(userId, { username: newUsername, isActive: false, deletedAt: new Date() });

    await this.personContactRepository.update(personContact.personContactId, contactUpdates);

    // Anonimizar dirección física (Ley 1581/2012)
    await this.personLocationRepository.anonymizeAddressByPersonId(personId);

    // Revocar todos los consentimientos vigentes
    await this.userConsentRepository.revokeAll(userId);

    await this.kycSharedUtil.logChange({
      userId,
      changedByUserId,
      changedByRole,
      changeType: 'account_status',
      previousValue: 'active',
      newValue: 'eliminated',
      changeReason,
      ipAddress: auditContext.ip || auditContext.ipAddress,
      userAgent: auditContext.userAgent
    });

    return {
      deletedEmail: email,
      deletedNationalId: newNationalId,
      firstName
    };
  }

  /** Contacto de la persona; 404 si no existe (antes: TypeError → 500 al leer sus campos). */
  async _requireContact(personId: string) {
    const contact = await this.personContactRepository.findByPersonId(personId);
    if (!contact) {
      throw AppError.notFound('Contacto de la persona no encontrado');
    }
    return contact;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace ProfileHelper {
  export type PhoneType = Types.PhoneType;
  export type AuditInfo = Types.AuditInfo;
  export type ChangeActor = Types.ChangeActor;
  export type LocationInput = Types.LocationInput;
  export type NamesInput = Types.NamesInput;
  export type UpdateEmailParams = Types.UpdateEmailParams;
  export type UpdatePhoneParams = Types.UpdatePhoneParams;
  export type UpdatePasswordParams = Types.UpdatePasswordParams;
  export type UpdateNationalIdParams = Types.UpdateNationalIdParams;
  export type DeleteAccountParams = Types.DeleteAccountParams;

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userRepository?: typeof userRepository;
    personRepository?: typeof personRepository;
    personContactRepository?: typeof personContactRepository;
    personLocationRepository?: typeof personLocationRepository;
    userConsentRepository?: typeof userConsentRepository;
    avatarRepository?: typeof avatarRepository;
    genderRepository?: typeof genderRepository;
    documentTypeRepository?: typeof documentTypeRepository;
    verificationCodeRepository?: typeof verificationCodeRepository;
    departmentRepository?: typeof departmentRepository;
    cityRepository?: typeof cityRepository;
    kycSharedUtil?: typeof KycSharedUtil;
  }
}

export default Object.assign(new ProfileHelper(), { ProfileHelper });
