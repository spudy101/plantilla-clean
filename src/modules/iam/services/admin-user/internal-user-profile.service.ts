// modules/admin/kyc/iam/services/admin-user/internal-user-profile.service.ts
//
// Alta y edición de datos básicos de usuarios internos. Extraído de AdminUserService (SOLID: S).

import type { AdminAuditContext } from '../../../../shared/application/audit-context';
import userRepository from '../../repositories/user.repository';
import roleRepository from '../../repositories/role.repository';
import personModule from '../../../person';
const { personRepository, ProfileHelper, KycSharedUtil } = personModule;
import catalogsModule from '../../../catalogs';
const { documentTypeRepository } = catalogsModule;
import InternalUserHelper from '../../helpers/internal-user.helper';
import notificationModule from '../../../notification';
const { notifier } = notificationModule;
import AppError from '../../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import auditModule from '../../../audit';
const { audit } = auditModule;
import auditDiffUtilModule from '../../../../shared/kernel/audit-diff.util';
const { buildAuditDiff } = auditDiffUtilModule;
import constantsModule from '../../../../shared/infrastructure/config';
const { RBAC_ROLES, notifications } = constantsModule;
import adminUserDtoModule from '../../responses/admin-user.response';
const { InternalUserDTO, InternalUserCreatedDTO } = adminUserDtoModule;
import internalUserGuardsModule from './internal-user-guards';
const { InternalUserGuards } = internalUserGuardsModule;
class InternalUserProfileService {
  userRepository: typeof userRepository;
  roleRepository: typeof roleRepository;
  personRepository: typeof personRepository;
  documentTypeRepository: typeof documentTypeRepository;
  profileHelper: typeof ProfileHelper;
  internalUserHelper: typeof InternalUserHelper;
  kycSharedUtil: typeof KycSharedUtil;
  notifier: typeof notifier;
  guards: InstanceType<typeof InternalUserGuards>;

  /** @param {object} [deps] Dependencias inyectables (SOLID: D). Las provee la fachada AdminUserService. */
  constructor(deps: InternalUserProfileService.Deps = {}) {
    this.userRepository = deps.userRepository ?? userRepository;
    this.roleRepository = deps.roleRepository ?? roleRepository;
    this.personRepository = deps.personRepository ?? personRepository;
    this.documentTypeRepository = deps.documentTypeRepository ?? documentTypeRepository;
    this.profileHelper = deps.profileHelper ?? ProfileHelper;
    this.internalUserHelper = deps.internalUserHelper ?? InternalUserHelper;
    this.kycSharedUtil = deps.kycSharedUtil ?? KycSharedUtil;
    this.notifier = deps.notifier ?? notifier;
    this.guards = deps.guards ?? new InternalUserGuards(deps);
  }

  async create(data: InternalUserProfileService.CreateInput, auditCtx: AdminAuditContext) {
    // Mínimo privilegio (criterio #5, RF-ADM-01): todo usuario interno nace como
    // AUDITOR — solo lectura. El admin sube el rol real después con PATCH /:userId/role.
    const role = await this.roleRepository.findByName(RBAC_ROLES.AUDITOR);
    if (!role) {
      throw AppError.internal(`Rol ${RBAC_ROLES.AUDITOR} no encontrado. Ejecuta el seeder RBAC.`);
    }

    // Los usuarios internos no tienen documento real: siempre llevan el tipo SYSTEM
    // ("Usuario de Sistema") para que su national_id sea un identificador de sistema.
    const systemDocumentType = await this.documentTypeRepository.findByCode('SYSTEM');
    if (!systemDocumentType) {
      throw AppError.internal("Tipo de documento 'SYSTEM' no encontrado. Ejecuta el seeder de tipos de documento.");
    }

    await this.profileHelper.validateNationalIdUnique(data.nationalId);
    await this.profileHelper.validateEmailUnique(data.email);

    const temporaryPassword = this.kycSharedUtil.generateSecurePassword();

    const { user } = await this.internalUserHelper.createInternalUser({
      email: data.email,
      password: temporaryPassword,
      firstName: data.firstName,
      middleName: data.middleName,
      lastName: data.lastName,
      secondLastName: data.secondLastName,
      nationalId: data.nationalId,
      documentTypeId: systemDocumentType.documentTypeId,
      role
    });

    await audit.record('INTERNAL_USER_CREATED', {
      actorId: auditCtx.adminUserId,
      details: { roleId: role.roleId, roleName: role.name },
      entityId: user.userId,
      entityType: 'InternalUser',
      entityTable: 'users'
    });

    setImmediate(() => {
      const { logoUrl } = notifications.ses;
      this.notifier.notify({
        type: 'IAM_INTERNAL_USER_CREATED',
        userId: user.userId,
        metadata: { nombre: data.firstName, email: data.email, passwordTemporal: temporaryPassword, logoUrl }
      }).catch(err => logger.warn('Error enviando IAM_INTERNAL_USER_CREATED', { error: err.message }));
      this.notifier.notify({
        type: 'IAM_ADMIN_USER_CREATED',
        userId: auditCtx.adminUserId,
        relatedEntity: { type: 'User', id: user.userId },
        metadata: { nombreUsuario: `${data.firstName} ${data.lastName || ''}`.trim(), email: data.email, logoUrl }
      }).catch(err => logger.warn('Error enviando IAM_ADMIN_USER_CREATED', { error: err.message }));
    });

    const fullUser = await this.userRepository.findByUserId(user.userId, 'basic');
    if (!fullUser) {
      throw AppError.internal('Usuario recién creado no encontrado');
    }
    // La contraseña temporal se devuelve SOLO en esta respuesta.
    return InternalUserCreatedDTO(fullUser, temporaryPassword);
  }

  async update(
    userId: string,
    data: Partial<Pick<InternalUserProfileService.CreateInput, 'firstName' | 'middleName' | 'lastName' | 'secondLastName'>>,
    auditCtx: AdminAuditContext
  ) {
    const user = await this.guards.getInternalUserOrFail(userId);
    this.guards.assertNotDeleted(user);

    const person = this.guards.requirePerson(user);

    const { before, after } = buildAuditDiff(person, data, {
      firstName: 'firstName',
      middleName: 'middleName',
      lastName: 'lastName',
      secondLastName: 'secondLastName'
    });

    await this.personRepository.update(person.personId, {
      firstName: data.firstName ?? person.firstName,
      middleName: data.middleName ?? person.middleName,
      lastName: data.lastName ?? person.lastName,
      secondLastName: data.secondLastName ?? person.secondLastName
    });

    await audit.record('INTERNAL_USER_UPDATED', {
      actorId: auditCtx.adminUserId,
      details: { before, after },
      entityId: userId,
      entityType: 'InternalUser',
      entityTable: 'persons'
    });

    const fresh = await this.userRepository.findByUserId(userId, 'basic');
    return InternalUserDTO(fresh);
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace InternalUserProfileService {
  export interface CreateInput {
    email: string;
    firstName: string;
    middleName?: string | null;
    lastName: string;
    secondLastName?: string | null;
    nationalId: string;
  }

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userRepository?: typeof userRepository;
    roleRepository?: typeof roleRepository;
    personRepository?: typeof personRepository;
    documentTypeRepository?: typeof documentTypeRepository;
    profileHelper?: typeof ProfileHelper;
    internalUserHelper?: typeof InternalUserHelper;
    kycSharedUtil?: typeof KycSharedUtil;
    notifier?: typeof notifier;
    guards?: InstanceType<typeof InternalUserGuards>;
  }
}

export default InternalUserProfileService;
