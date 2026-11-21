import type { Person } from '../../../shared/database/generated/prisma/client';
import { interopDefault } from '../../../shared/utils/interop.util';
import type * as ProfileTypes from '../helpers/profile.types';
import type { RequestAuditContext } from '../../../shared/types/audit-context';
import unitOfWork from '../../../shared/database/unit-of-work';
import iamModule from '../../iam';
const { userRepository } = iamModule;
import personRepository from '../repositories/person.repository';
import legalModule from '../../legal';
const { userConsentRepository, consentTypeRepository } = legalModule;
import notificationModule from '../../notification';
const { notifier } = notificationModule;
import AppError from '../../../shared/http/app-error.util';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import KycSharedUtil from '../utils/kyc-shared.util';
import ProfileHelper from '../helpers/profile.helper';
import profileDtoModule from '../responses/profile.response';
import auditModule from '../../audit';
const { audit } = auditModule;
const {
  BasicProfileDTO,
  ExtendedProfileDTO,
  UpdateEmailResponseDTO,
  UpdatePhoneResponseDTO,
  UpdateNamesResponseDTO
} = profileDtoModule;

class ProfileService {
  unitOfWork: typeof unitOfWork;
  profileHelper: typeof ProfileHelper;
  userRepository: typeof userRepository;
  personRepository: typeof personRepository;
  userConsentRepository: typeof userConsentRepository;
  consentTypeRepository: typeof consentTypeRepository;
  notifier: typeof notifier;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new ProfileService({ unitOfWork: fake })
   * @param {object} [deps]
   */
  constructor(deps: ProfileService.Deps = {}) {
    this.unitOfWork = deps.unitOfWork ?? unitOfWork;
    this.profileHelper = deps.profileHelper ?? ProfileHelper;
    this.userRepository = deps.userRepository ?? userRepository;
    this.personRepository = deps.personRepository ?? personRepository;
    this.userConsentRepository = deps.userConsentRepository ?? userConsentRepository;
    this.consentTypeRepository = deps.consentTypeRepository ?? consentTypeRepository;
    this.notifier = deps.notifier ?? notifier;
  }

  // ============================================================
  // CONSULTAS
  // ============================================================

  async getProfile(userId: string) {
    const user = await this.userRepository.findByUserId(userId, 'basic');
    if (!user) {
      throw AppError.notFound('Usuario no encontrado');
    }
    const [consentTypes, consents] = await Promise.all([
      this.consentTypeRepository.findAllActive(),
      this.userConsentRepository.findCurrentByUser(userId)
    ]);
    await audit.record('PROFILE_VIEWED', {
      actorId: userId,
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });
    return BasicProfileDTO(user, consentTypes, consents);
  }

  async getExtendedProfile(userId: string) {
    const user = await this.userRepository.findByUserId(userId, 'full');
    if (!user) {
      throw AppError.notFound('Usuario no encontrado');
    }
    const [consentTypes, consents] = await Promise.all([
      this.consentTypeRepository.findAllActive(),
      this.userConsentRepository.findCurrentByUser(userId)
    ]);
    await audit.record('PROFILE_EXTENDED_VIEWED', {
      actorId: userId,
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });
    return ExtendedProfileDTO(user, consentTypes, consents);
  }

  async getContactInfo(personId: string, userId: string) {
    const { PersonContactComponent } = interopDefault(require('../responses/person-components.response') as typeof import('../responses/person-components.response'));
    const personContactRepository = interopDefault(require('../repositories/person-contact.repository') as typeof import('../repositories/person-contact.repository'));
    const contact = await personContactRepository.findByPersonIdWithPrefixes(personId);
    if (!contact) {
      throw AppError.notFound('Informacion de contacto no encontrada');
    }
    await audit.record('PROFILE_CONTACT_VIEWED', {
      actorId: userId,
      details: { personId },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });
    return PersonContactComponent.build(contact);
  }

  async getLocation(personId: string, userId: string) {
    const { PersonLocationComponent } = interopDefault(require('../responses/person-components.response') as typeof import('../responses/person-components.response'));
    const personLocationRepository = interopDefault(require('../repositories/person-location.repository') as typeof import('../repositories/person-location.repository'));
    const location = await personLocationRepository.findByPersonId(personId);
    await audit.record('PROFILE_LOCATION_VIEWED', {
      actorId: userId,
      details: { personId },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });
    return PersonLocationComponent.build(location);
  }

  // ============================================================
  // ACTUALIZACIONES
  // ============================================================

  async updateProfile(
    data: ProfileService.UpdateProfileInput,
    userId: string,
    personId: string,
    username: string | null,
    firstName: string | null,
    auditContext: ProfileTypes.AuditInfo = {}
  ) {
    const snapshot = await this.profileHelper.fetchPersonSnapshot(personId);

    await this.unitOfWork.run(async () => {
      if (data.username && data.username !== username) {
        await this.profileHelper.updateUsername(userId, data.username);
      }
      if (data.avatarId) {
        await this.profileHelper.updateAvatar(userId, data.avatarId);
      }
      if (data.genderId) {
        await this.profileHelper.updateGender(personId, data.genderId);
      }
      if (data.location) {
        await this.profileHelper.updateLocation(personId, data.location);
      }
      if (data.birthDate) {
        await this.profileHelper.updateBirthDate(personId, data.birthDate);
      }

      await _logProfileFieldChanges({ data, snapshot, userId, auditContext });
    });

    await audit.record('PROFILE_UPDATED', {
      actorId: userId,
      details: {
        updatedFields: Object.keys(data)
      },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    setImmediate(() => {
      this.notifier.notify({
        type: 'PROFILE_UPDATED',
        userId,
        relatedEntity: null,
        metadata: { nombre: firstName }
      }).catch(err =>
        logger.warn('Error enviando notificacion profile updated', {
          error: err.message,
          userId
        })
      );
    });

    const updatedUser = await this.userRepository.findByUserId(userId, 'full');
    if (!updatedUser) {
      throw AppError.notFound('Usuario no encontrado');
    }
    return ExtendedProfileDTO(updatedUser);
  }

  async updateEmail(data: { email: string; currentPassword: string }, userId: string, personId: string, firstName: string | null, auditContext: RequestAuditContext) {
    const { email, currentPassword } = data;

    const user = await this._getUserSecure(userId);
    await this.profileHelper.validateCurrentPassword(user.passwordHash, currentPassword);

    const newEmail = await this.unitOfWork.run(async () => {
      const { newEmail } = await this.profileHelper.updateEmailLogic({
        userId,
        personId,
        newEmail: email,
        changedByUserId: userId,
        changedByRole: 'user',
        changeReason: 'Email actualizado por cliente',
        auditContext,
        skipVerificationCheck: false
      });
      return newEmail;
    });

    // Cambio de email — riesgo high, dato de contacto crítico
    await audit.record('PROFILE_EMAIL_UPDATED', {
      actorId: userId,
      details: { newEmail },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    setImmediate(() => {
      this.notifier.notify({
        type: 'EMAIL_UPDATED',
        userId,
        relatedEntity: null,
        metadata: { nombre: firstName }
      }).catch(err => logger.warn('Error enviando notificacion email updated', { error: err.message, userId }));
    });

    return UpdateEmailResponseDTO(newEmail, new Date());
  }

  async updatePhone(
    data: { newPhone: string; phonePrefixId: string; phoneType: ProfileTypes.PhoneType },
    userId: string,
    personId: string,
    firstName: string | null,
    auditContext: ProfileTypes.AuditInfo = {}
  ) {
    const { newPhone, phonePrefixId, phoneType } = data;
    const result = await this.unitOfWork.run(async () => {
      const result = await this.profileHelper.updatePhoneLogic({
        personId,
        phone: newPhone,
        phonePrefixId,
        phoneType,
        userId,
        changedByUserId: userId,
        changedByRole: 'user',
        auditContext
      });
      return result;
    });

    await audit.record('PROFILE_PHONE_UPDATED', {
      actorId: userId,
      details: { phoneType },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    setImmediate(() => {
      this.notifier.notify({
        type: 'PHONE_UPDATED',
        userId,
        relatedEntity: null,
        metadata: { nombre: firstName }
      }).catch(err => logger.warn('Error enviando notificacion phone updated', { error: err.message, userId }));
    });

    return UpdatePhoneResponseDTO(result.phone, result.phonePrefixId, result.phoneType, new Date());
  }

  async updatePassword(data: { currentPassword: string; newPassword: string }, userId: string, firstName: string | null, auditContext: RequestAuditContext) {
    const { currentPassword, newPassword } = data;

    const user = await this._getUserSecure(userId);
    await this.profileHelper.validateCurrentPassword(user.passwordHash, currentPassword);

    await this.unitOfWork.run(async () => {
      await this.profileHelper.updatePasswordLogic({
        userId,
        newPassword,
        changedByUserId: userId,
        changedByRole: 'user',
        changeReason: 'Contrasena actualizada por cliente',
        auditContext
      });
    });

    // Cambio de contraseña — riesgo high
    await audit.record('PASSWORD_CHANGED', {
      actorId: userId,
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    setImmediate(() => {
      this.notifier.notify({
        type: 'PASSWORD_UPDATED',
        userId,
        relatedEntity: null,
        metadata: { nombre: firstName }
      }).catch(err =>
        logger.warn('Error enviando notificacion password updated', {
          error: err.message,
          userId
        })
      );
    });

    return null;
  }

  /**
   * Actualiza los nombres del cliente (primer/segundo nombre, primer/segundo apellido).
   * En la plantilla no hay validación de identidad, así que los nombres son libremente editables.
   */
  async updateNames(
    data: ProfileTypes.NamesInput,
    userId: string,
    personId: string,
    firstName: string | null,
    auditContext: RequestAuditContext
  ) {
    await this.unitOfWork.run(async () => {
      const before = await this.personRepository.findById(personId);
      if (!before) {
        throw AppError.notFound('Persona no encontrada');
      }
      const previousName = _composeFullName(before);

      await this.profileHelper.updateNames(personId, {
        firstName: data.firstName,
        middleName: data.middleName,
        lastName: data.lastName,
        secondLastName: data.secondLastName
      });

      const newName = _composeFullName({
        firstName: data.firstName !== undefined ? data.firstName : before.firstName,
        middleName: data.middleName !== undefined ? (data.middleName === '' ? null : data.middleName) : before.middleName,
        lastName: data.lastName !== undefined ? data.lastName : before.lastName,
        secondLastName:
          data.secondLastName !== undefined ? (data.secondLastName === '' ? null : data.secondLastName) : before.secondLastName
      });

      if (previousName !== newName) {
        await KycSharedUtil.logChange({
          userId,
          changedByUserId: userId,
          changedByRole: 'user',
          changeType: 'name',
          previousValue: previousName,
          newValue: newName,
          ipAddress: auditContext?.ip || auditContext?.ipAddress || null,
          userAgent: auditContext?.userAgent || null
        });
      }
    });

    await audit.record('PROFILE_UPDATED', {
      actorId: userId,
      details: { updatedFields: Object.keys(data) },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    setImmediate(() => {
      this.notifier.notify({
        type: 'PROFILE_UPDATED',
        userId,
        relatedEntity: null,
        metadata: { nombre: firstName }
      }).catch(err => logger.warn('Error enviando notificacion profile updated', { error: err.message, userId }));
    });

    const updatedPerson = await this.personRepository.findById(personId);
    if (!updatedPerson) {
      throw AppError.notFound('Persona no encontrada');
    }
    return UpdateNamesResponseDTO(updatedPerson);
  }

  async deleteAccount(data: { currentPassword: string }, { userId, personId, nationalId, email, firstName, auditContext }: ProfileService.DeleteAccountContext) {
    const { currentPassword } = data;

    const user = await this._getUserSecure(userId);
    await this.profileHelper.validateCurrentPassword(user.passwordHash, currentPassword);

    const result = await this.unitOfWork.run(async () => {
      const result = await this.profileHelper.deleteAccountLogic({
        userId,
        personId,
        nationalId,
        email,
        username: user.username,
        firstName: firstName || user.person?.firstName || 'Usuario',
        changedByUserId: userId,
        changedByRole: 'user',
        changeReason: 'Cuenta eliminada por el usuario',
        auditContext
      });
      return result;
    });

    // Eliminación de cuenta — crítico, acción irreversible
    await audit.record('ACCOUNT_DELETED', {
      actorId: userId,
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    const { deletedEmail } = result;
    if (deletedEmail) {
      setImmediate(() => {
        this.notifier.notifyEmail({
          type: 'CUENTA_ELIMINADA',
          email: deletedEmail,
          metadata: {
            nombre: result.firstName,
            email: deletedEmail
          }
        }).catch(err =>
          logger.warn('Error sending account deletion notification', {
            userId,
            error: err.message
          })
        );
      });
    }

    return null;
  }

  /** @private */
  async _getUserSecure(userId: string) {
    const user = await this.userRepository.findByUserId(userId, 'minimal');
    if (!user) {
      throw AppError.notFound('Usuario no encontrado');
    }
    return user;
  }
}

// ============================================================
// PRIVADO — arma el nombre completo a partir de las partes de la persona
// ============================================================

function _composeFullName(
  person: Partial<Pick<Person, 'firstName' | 'middleName' | 'lastName' | 'secondLastName'>> | null | undefined
) {
  return [person?.firstName, person?.middleName, person?.lastName, person?.secondLastName].filter(Boolean).join(' ');
}

// ============================================================
// PRIVADO — registra en user_change_logs los campos de perfil modificados
// ============================================================

async function _logProfileFieldChanges({
  data,
  snapshot,
  userId,
  auditContext
}: {
  data: ProfileService.UpdateProfileInput;
  snapshot: Awaited<ReturnType<(typeof ProfileHelper)['fetchPersonSnapshot']>>;
  userId: string;
  auditContext: ProfileTypes.AuditInfo;
}) {
  const ip = auditContext?.ip || auditContext?.ipAddress || null;
  const ua = auditContext?.userAgent || null;
  const base = {
    userId,
    changedByUserId: userId,
    changedByRole: 'user' as const,
    ipAddress: ip,
    userAgent: ua
  };

  if (data.genderId && data.genderId !== snapshot.genderId) {
    await KycSharedUtil.logChange({
      ...base,
      changeType: 'gender',
      previousValue: snapshot.genderId ?? null,
      newValue: data.genderId
    });
  }

  if (data.birthDate) {
    const prev = snapshot.birthDate ? new Date(snapshot.birthDate).toISOString().slice(0, 10) : null;
    const next = new Date(data.birthDate).toISOString().slice(0, 10);
    if (prev !== next) {
      await KycSharedUtil.logChange({
        ...base,
        changeType: 'birth_date',
        previousValue: prev,
        newValue: next
      });
    }
  }

  if (data.location) {
    await KycSharedUtil.logChange({
      ...base,
      changeType: 'location',
      previousValue: snapshot.location ? JSON.stringify(snapshot.location) : null,
      newValue: JSON.stringify(data.location),
      changeReason: 'Ubicación de residencia'
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace ProfileService {
  export interface UpdateProfileInput {
    username?: string;
    avatarId?: string;
    genderId?: string;
    location?: ProfileTypes.LocationInput;
    birthDate?: string;
  }

  /** Datos de la sesión del titular que el controller pasa al eliminar la cuenta. */
  export interface DeleteAccountContext {
    userId: string;
    personId: string;
    /** Del token: puede faltar en tokens viejos (la ofuscación no depende del valor previo) */
    nationalId: string | null;
    email?: string | null;
    firstName?: string | null;
    auditContext: ProfileTypes.AuditInfo;
  }

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    unitOfWork?: typeof unitOfWork;
    profileHelper?: typeof ProfileHelper;
    userRepository?: typeof userRepository;
    personRepository?: typeof personRepository;
    userConsentRepository?: typeof userConsentRepository;
    consentTypeRepository?: typeof consentTypeRepository;
    notifier?: typeof notifier;
  }
}

export default Object.assign(new ProfileService(), { ProfileService });
