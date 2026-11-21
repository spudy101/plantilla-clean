import type { User } from '../../../../shared/database/generated/prisma/client';
// modules/admin/kyc/person/services/admin-person/person-creation.service.ts
//
// Alta de cuentas de cliente desde el panel admin (persona + contacto + usuario
// en una transacción) y notificaciones de bienvenida. Extraído de PersonService (SOLID: S).

import type { AdminAuditContext } from '../../../../shared/types/audit-context';
import { v4 as uuidv4 } from 'uuid';
import unitOfWork from '../../../../shared/database/unit-of-work';
import iamModule from '../../../iam';
const { userRepository, roleRepository } = iamModule;
import personRepository from '../../repositories/person.repository';
import personContactRepository from '../../repositories/person-contact.repository';
import KycSharedUtil from '../../utils/kyc-shared.util';
import notificationModule from '../../../notification';
const { notifier } = notificationModule;
import AppError from '../../../../shared/http/app-error.util';
import loggerUtilModule from '../../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import ProfileHelper from '../../helpers/profile.helper';
import constantsModule from '../../../../shared/constants';
const { notifications, RBAC_ROLES } = constantsModule;

import adminPersonDtoModule from '../../responses/admin-person.response';
const { CreateUserDTO } = adminPersonDtoModule;
import auditModule from '../../../audit';
const { audit } = auditModule;

class PersonCreationService {
  unitOfWork: typeof unitOfWork;
  profileHelper: typeof ProfileHelper;
  userRepository: typeof userRepository;
  personRepository: typeof personRepository;
  personContactRepository: typeof personContactRepository;
  roleRepository: typeof roleRepository;
  notifier: typeof notifier;

  /**
   * @param {object} [deps] Dependencias inyectables (SOLID: D). Las provee la fachada
   *   PersonService; por defecto se usan las implementaciones reales.
   */
  constructor(deps: PersonCreationService.Deps = {}) {
    this.unitOfWork = deps.unitOfWork ?? unitOfWork;
    this.profileHelper = deps.profileHelper ?? ProfileHelper;
    this.userRepository = deps.userRepository ?? userRepository;
    this.personRepository = deps.personRepository ?? personRepository;
    this.personContactRepository = deps.personContactRepository ?? personContactRepository;
    this.roleRepository = deps.roleRepository ?? roleRepository;
    this.notifier = deps.notifier ?? notifier;
  }

  // ============================================================
  // CREACIÓN
  // ============================================================

  async create(userData: PersonCreationService.CreateInput, auditContext: AdminAuditContext) {
    const { role, user, temporaryPassword } = await this.unitOfWork.run(async () => {
      const role = await this.roleRepository.findByName(RBAC_ROLES.CLIENTE);
      if (!role) {
        throw AppError.internal(`Rol ${RBAC_ROLES.CLIENTE} no configurado. Ejecuta el seeder RBAC.`);
      }

      KycSharedUtil.validateNationalIdByRole(userData.nationalId, role);
      await this.profileHelper.validateNationalIdUnique(userData.nationalId);
      await this.profileHelper.validateEmailUnique(userData.email);

      const temporaryPassword = KycSharedUtil.generateSecurePassword();
      const authUsername = `user_${uuidv4()}`;

      const user = await this._createDbRecords(userData, authUsername, temporaryPassword, role.roleId);
      return { role, user, temporaryPassword };
    });

    // Después del commit: un error acá ya no intenta revertir la transacción confirmada
    await audit.record('PERSON_CREATED', {
      actorId: auditContext.adminUserId,
      details: {
        roleId: role.roleId,
        roleName: role.name
      },
      entityId: user.userId,
      entityType: 'User',
      entityTable: 'users'
    });

    setImmediate(() => this._sendCreateNotifications(userData, user, auditContext, temporaryPassword));

    const fullUser = await this.userRepository.findByUserId(user.userId, 'full');
    if (!fullUser) {
      throw AppError.internal('Usuario recién creado no encontrado');
    }
    return CreateUserDTO(fullUser, temporaryPassword);
  }

  /** @private */
  async _createDbRecords(
    userData: PersonCreationService.CreateInput,
    authUsername: string,
    temporaryPassword: string,
    roleId: string
  ) {
    const person = await this.personRepository.create({
      firstName: userData.firstName,
      middleName: userData.middleName || null,
      lastName: userData.lastName,
      secondLastName: userData.secondLastName || null,
      nationalId: userData.nationalId,
      birthDate: userData.birthDate || null,
      genderId: userData.genderId || null,
      countryId: userData.countryId || null,
      documentTypeId: userData.documentTypeId || null
    });

    await this.personContactRepository.create({
      personId: person.personId,
      email: userData.email,
      emailVerifiedAt: new Date()
    });

    return this.userRepository.createWithPassword({
      username: authUsername,
      authUsername: authUsername,
      personId: person.personId,
      roleId: roleId,
      password: temporaryPassword
    });
  }

  /** @private */
  _sendCreateNotifications(
    userData: PersonCreationService.CreateInput,
    user: Pick<User, 'userId'>,
    auditContext: AdminAuditContext,
    temporaryPassword: string
  ) {
    this.notifier.notify({
      type: 'USUARIO_CREADO_ADMIN',
      userId: user.userId,
      relatedEntity: null,
      metadata: {
        nombre: userData.firstName,
        email: userData.email,
        passwordTemporal: temporaryPassword,
        logoUrl: notifications.ses.logoUrl
      }
    }).catch(err => logger.warn('Error sending welcome notification', { error: err.message }));

    this.notifier.notify({
      type: 'PERSON_ADMIN_ACTION',
      userId: auditContext.adminUserId,
      relatedEntity: null,
      metadata: {
        nombre: auditContext.adminFirstName,
        accion: 'crear',
        userId: user.userId,
        logoUrl: notifications.ses.logoUrl
      }
    }).catch(err => logger.warn('Error sending admin action notification', { error: err.message }));
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace PersonCreationService {
  /** Alta de cliente desde el panel admin (body validado por PersonValidator.create). */
  export interface CreateInput {
    email: string;
    firstName: string;
    middleName?: string | null;
    lastName: string;
    secondLastName?: string | null;
    nationalId: string;
    documentTypeId?: string | null;
    genderId?: string | null;
    countryId?: string | null;
    birthDate?: string | null;
  }

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    unitOfWork?: typeof unitOfWork;
    profileHelper?: typeof ProfileHelper;
    userRepository?: typeof userRepository;
    personRepository?: typeof personRepository;
    personContactRepository?: typeof personContactRepository;
    roleRepository?: typeof roleRepository;
    notifier?: typeof notifier;
  }
}

export default PersonCreationService;
