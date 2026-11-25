// Casos de uso de la gestión de USUARIOS INTERNOS (empleados) — RF-ADM-01. La gestión de clientes es de person.
//
//   lecturas        listado (vigentes y eliminados), opciones de rol, detalle, sesiones activas, bitácora
//   alta / edición  todo interno nace AUDITOR (mínimo privilegio); los nombres se editan acá
//   acceso          cambio de rol (doble aprobación), activar / desactivar, cerrar sesiones
//   eliminación     re-autenticación del admin + doble aprobación + ofuscación irreversible (la baja es de person)
//
// El cambio de rol y la eliminación pasan por el gate de approvals: pendiente → 202, y approvals reanuda la ejecución
// real (ExecuteInternalRoleChange / ExecuteInternalUserDeletion) cuando el segundo funcionario aprueba.
import { pageOf, pageRequest, type PageQuery } from '../../../../shared/application/pagination';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import auditDiffUtilModule from '../../../../shared/kernel/audit-diff.util';
import rbacModule from '../../../../shared/domain/constants/rbac';
import { AccountWithoutPersonError, IamForbiddenError, IamInternalError, IamInvalidInputError, IamNotFoundError, UserNotFoundError } from '../../domain/errors';
import { assertNotDeleted, displayName, isInternalRole, isSuperAdminRole, type RoleRef, type UserProfile } from '../../domain/user';
import adminUserDtoModule, { type InternalUserDeleted, type InternalUserSessionsClosed } from '../dto/admin-user.output';
import type { ApprovalContext } from '../ports/module-sources.port';
import type { IamDeps } from './iam-deps';

const { errorMessage } = errorMessageModule;
const { buildAuditDiff } = auditDiffUtilModule;
const { INTERNAL_ROLE_NAMES, SUPERADMIN_ROLE_NAMES, RBAC_ROLES } = rbacModule;
const { InternalUserDTO, InternalUserListDTO, InternalUserCreatedDTO, UserSessionDTO, UserChangeLogDTO, RoleOptionDTO } = adminUserDtoModule;

const ENTITY = { entityType: 'InternalUser', entityTable: 'users' };

/** El funcionario que actúa (maker) y desde dónde. */
export type AdminContext = ApprovalContext;

export type InternalUserListQuery = PageQuery & { search?: string | null; roleId?: string | null; isActive?: boolean | null };
export type InternalUserDeletedListQuery = PageQuery & { search?: string | null; roleId?: string | null };

export interface NewInternalUser {
  email: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  secondLastName?: string | null;
  nationalId: string;
}

export type InternalUserNames = Partial<Pick<NewInternalUser, 'firstName' | 'middleName' | 'lastName' | 'secondLastName'>>;

// ============================================================
// REGLAS COMPARTIDAS
// ============================================================

export class InternalUserGuards {
  constructor(private readonly deps: Pick<IamDeps, 'users' | 'roles' | 'sessions' | 'revocations' | 'logger'>) {}

  async getInternalUserOrFail(userId: string): Promise<UserProfile> {
    const user = await this.deps.users.findProfile(userId);
    if (!user) {
      throw new UserNotFoundError();
    }
    if (!isInternalRole(user.role?.name)) {
      throw new IamNotFoundError('Usuario interno no encontrado');
    }
    return user;
  }

  async getInternalRoleOrFail(roleId: string): Promise<RoleRef> {
    const role = await this.deps.roles.findById(roleId);
    if (!role) {
      throw new IamNotFoundError('Rol no encontrado');
    }
    if (!isInternalRole(role.name)) {
      throw new IamInvalidInputError('El rol indicado no es un rol interno');
    }
    return role;
  }

  /** Los roles internos visibles en el listado: nunca se listan los superadministradores. */
  async listableInternalRoleIds(): Promise<string[]> {
    const roles = await this.deps.roles.findByNames(INTERNAL_ROLE_NAMES, { exclude: SUPERADMIN_ROLE_NAMES });
    return roles.map(r => r.roleId);
  }

  /** Cierra las sesiones en BD y las invalida en Redis. */
  async invalidateSessions(userId: string, reason: string) {
    await this.deps.sessions.closeAllByUser(userId, reason);
    await this.deps.revocations
      .invalidateUserSessions(userId)
      .catch(err => this.deps.logger.warn('Error invalidando sesiones en Redis', { error: err.message, userId }));
  }
}

/** La persona de la cuenta (person_id es NOT NULL: si falta, la lectura no la trajo). */
function requirePerson<P>(user: { person?: P | null }): P {
  if (!user.person) {
    throw new AccountWithoutPersonError();
  }
  return user.person;
}

type QueryDeps = Pick<IamDeps, 'users' | 'roles' | 'sessions' | 'changeHistory' | 'approvals' | 'audit'> & { guards: InternalUserGuards };

/** Los roles del filtro: si viene uno interno (y no superadmin) se usa; si no, todos los internos visibles. */
async function roleIdsFor(guards: InternalUserGuards, roleId: string | null | undefined) {
  const internalRoleIds = await guards.listableInternalRoleIds();
  return roleId && internalRoleIds.includes(roleId) ? [roleId] : internalRoleIds;
}

// ============================================================
// LECTURAS
// ============================================================

export class ListInternalUsers {
  constructor(private readonly deps: QueryDeps) {}

  async execute(query: InternalUserListQuery, adminUserId: string) {
    const { users, approvals, audit, guards } = this.deps;
    const page = pageRequest(query);
    const roleIds = await roleIdsFor(guards, query.roleId);

    // Un admin no se ve a sí mismo en el listado
    const { rows, count } = await users.list({ roleIds, excludeUserId: adminUserId, isActive: query.isActive ?? undefined }, page, query.search ?? null);

    // El badge de la solicitud de doble aprobación pendiente sobre cada usuario
    const pending = rows.length > 0 ? await approvals.findPending('User', rows.map(row => row.userId).filter(Boolean)) : new Map<string, unknown>();
    const annotated = rows.map(row => Object.assign(row, { pendingApproval: pending.get(row.userId) ?? null }));

    await audit.record('INTERNAL_USER_LIST_VIEWED', { actorId: adminUserId, details: { totalItems: count }, ...ENTITY });
    return pageOf(annotated.map(InternalUserListDTO), page, count, { search: query.search, roleId: query.roleId, isActive: query.isActive });
  }
}

/** El histórico de internos ELIMINADOS (solo lectura: son intocables). */
export class ListDeletedInternalUsers {
  constructor(private readonly deps: QueryDeps) {}

  async execute(query: InternalUserDeletedListQuery, adminUserId: string) {
    const { users, audit, guards } = this.deps;
    const page = pageRequest(query);
    const roleIds = await roleIdsFor(guards, query.roleId);
    const { rows, count } = await users.list({ roleIds, onlyDeleted: true }, page, query.search ?? null);
    await audit.record('INTERNAL_USER_DELETED_LIST_VIEWED', { actorId: adminUserId, details: { totalItems: count }, ...ENTITY });
    return pageOf(rows.map(InternalUserListDTO), page, count, { search: query.search, roleId: query.roleId });
  }
}

/** Los roles internos listables (para el filtro por rol del listado). */
export class ListInternalRoleOptions {
  constructor(private readonly deps: QueryDeps) {}

  async execute(adminUserId: string) {
    const roles = await this.deps.roles.findByNames(INTERNAL_ROLE_NAMES, { exclude: SUPERADMIN_ROLE_NAMES });
    await this.deps.audit.record('INTERNAL_USER_ROLE_OPTIONS_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: roles.length },
      entityType: 'RbacRole',
      entityTable: 'roles'
    });
    return roles.map(RoleOptionDTO);
  }
}

export class GetInternalUser {
  constructor(private readonly deps: QueryDeps) {}

  async execute(userId: string, adminUserId: string) {
    const user = await this.deps.guards.getInternalUserOrFail(userId);
    await this.deps.audit.record('INTERNAL_USER_VIEWED', { actorId: adminUserId, details: { targetUserId: userId }, entityId: userId, ...ENTITY });
    return InternalUserDTO(user);
  }
}

export class ListInternalUserSessions {
  constructor(private readonly deps: QueryDeps) {}

  async execute(userId: string, adminUserId: string) {
    await this.deps.guards.getInternalUserOrFail(userId);
    const sessions = await this.deps.sessions.findActiveByUser(userId);
    await this.deps.audit.record('INTERNAL_USER_SESSIONS_VIEWED', {
      actorId: adminUserId,
      details: { targetUserId: userId },
      entityId: userId,
      ...ENTITY
    });
    return sessions.map(UserSessionDTO);
  }
}

export class ListInternalUserChangeLogs {
  constructor(private readonly deps: QueryDeps) {}

  async execute(userId: string, query: PageQuery, adminUserId: string) {
    await this.deps.guards.getInternalUserOrFail(userId);
    const page = pageRequest(query);
    const { rows, count } = await this.deps.changeHistory.listByUser(userId, page);
    await this.deps.audit.record('INTERNAL_USER_CHANGE_LOGS_VIEWED', {
      actorId: adminUserId,
      details: { targetUserId: userId },
      entityId: userId,
      ...ENTITY
    });
    return pageOf(rows.map(UserChangeLogDTO), page, count);
  }
}

// ============================================================
// ALTA / EDICIÓN
// ============================================================

type ProfileDeps = Pick<
  IamDeps,
  'users' | 'roles' | 'catalogs' | 'holders' | 'identity' | 'temporaryPasswords' | 'passwords' | 'random' | 'errors' | 'unitOfWork' | 'audit' | 'notifier' | 'logger' | 'policy'
> & { guards: InternalUserGuards };

export class CreateInternalUser {
  constructor(private readonly deps: ProfileDeps) {}

  async execute(data: NewInternalUser, auditCtx: AdminContext) {
    const { roles, catalogs, identity, temporaryPasswords, users, audit, notifier, logger, policy } = this.deps;
    // Mínimo privilegio (criterio #5): todo interno nace AUDITOR; el rol real se sube después
    const role = await roles.findByName(RBAC_ROLES.AUDITOR);
    if (!role) {
      throw new IamInternalError(`Rol ${RBAC_ROLES.AUDITOR} no encontrado. Ejecuta el seeder RBAC.`);
    }
    // Los internos no tienen documento real: siempre llevan el tipo SYSTEM ("Usuario de Sistema")
    const systemDocumentType = await catalogs.documentTypeByCode('SYSTEM');
    if (!systemDocumentType) {
      throw new IamInternalError("Tipo de documento 'SYSTEM' no encontrado. Ejecuta el seeder de tipos de documento.");
    }

    await identity.assertNationalIdAvailable(data.nationalId);
    await identity.assertEmailAvailable(data.email);

    const temporaryPassword = temporaryPasswords.generate();
    const user = await this.createInDb(data, temporaryPassword, systemDocumentType.documentTypeId, role);

    await audit.record('INTERNAL_USER_CREATED', {
      actorId: auditCtx.adminUserId,
      details: { roleId: role.roleId, roleName: role.name },
      entityId: user.userId,
      entityType: 'InternalUser',
      entityTable: 'users'
    });

    setImmediate(() => {
      const logoUrl = policy.notificationLogoUrl;
      notifier
        .notify({
          type: 'IAM_INTERNAL_USER_CREATED',
          userId: user.userId,
          metadata: { nombre: data.firstName, email: data.email, passwordTemporal: temporaryPassword, logoUrl }
        })
        .catch(err => logger.warn('Error enviando IAM_INTERNAL_USER_CREATED', { error: err.message }));
      notifier
        .notify({
          type: 'IAM_ADMIN_USER_CREATED',
          userId: auditCtx.adminUserId,
          relatedEntity: { type: 'User', id: user.userId },
          metadata: { nombreUsuario: `${data.firstName} ${data.lastName || ''}`.trim(), email: data.email, logoUrl }
        })
        .catch(err => logger.warn('Error enviando IAM_ADMIN_USER_CREATED', { error: err.message }));
    });

    const fullUser = await users.findProfile(user.userId);
    if (!fullUser) {
      throw new IamInternalError('Usuario recién creado no encontrado');
    }
    // La contraseña temporal se devuelve SOLO en esta respuesta
    return InternalUserCreatedDTO(fullUser, temporaryPassword);
  }

  /** Persona → contacto → usuario, en una transacción. */
  private async createInDb(data: NewInternalUser, password: string, documentTypeId: string, role: RoleRef) {
    const { holders, users, passwords, random, errors, unitOfWork, logger } = this.deps;
    const authUsername = `staff_${random.uuid()}`;
    try {
      const user = await unitOfWork.run(async () => {
        const { person } = await holders.create(
          {
            firstName: data.firstName,
            middleName: data.middleName || null,
            lastName: data.lastName,
            secondLastName: data.secondLastName || null,
            nationalId: data.nationalId,
            documentTypeId: documentTypeId || null
          },
          { email: data.email, emailVerifiedAt: new Date() }
        );
        return users.create({
          username: authUsername,
          authUsername,
          passwordHash: await passwords.hash(password),
          personId: person.personId,
          roleId: role.roleId
        });
      });
      logger.info('Usuario interno creado en BD', { userId: user.userId, roleId: role.roleId });
      return user;
    } catch (error) {
      if (errors.shouldPropagate(error)) {
        throw error;
      }
      logger.error('createInternalUser — fallo al crear en BD', { error: errorMessage(error) });
      throw new IamInternalError('Error al crear el usuario interno. Intenta nuevamente');
    }
  }
}

export class UpdateInternalUser {
  constructor(private readonly deps: ProfileDeps) {}

  async execute(userId: string, data: InternalUserNames, auditCtx: AdminContext) {
    const { guards, holders, users, audit } = this.deps;
    const user = await guards.getInternalUserOrFail(userId);
    assertNotDeleted(user);
    const person = requirePerson(user);

    const { before, after } = buildAuditDiff(person, data, {
      firstName: 'firstName',
      middleName: 'middleName',
      lastName: 'lastName',
      secondLastName: 'secondLastName'
    });

    await holders.updateNames(person.personId, {
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

    return InternalUserDTO(await users.findProfile(userId));
  }
}

// ============================================================
// ACCESO
// ============================================================

type AccessDeps = Pick<IamDeps, 'users' | 'changeLog' | 'approvals' | 'audit' | 'notifier' | 'logger' | 'policy'> & { guards: InternalUserGuards };

/**
 * El cambio de rol REAL: update + bitácora + invalidación de sesiones + avisos. Lo reanuda approvals al aprobarse
 * (RBAC_ROLE_CHANGE, sin volver a pasar por el gate) y lo ejecuta ChangeInternalRole cuando no hace falta aprobación.
 */
export class ExecuteInternalRoleChange {
  constructor(private readonly deps: AccessDeps) {}

  async execute(userId: string, newRoleId: string, auditCtx: AdminContext, prefetched: { user?: UserProfile; newRole?: RoleRef } = {}) {
    const { users, changeLog, audit, notifier, logger, policy, guards } = this.deps;
    const user = prefetched.user ?? (await guards.getInternalUserOrFail(userId));
    const newRole = prefetched.newRole ?? (await guards.getInternalRoleOrFail(newRoleId));
    const oldRoleName = user.role?.name || null;

    await users.update(userId, { roleId: newRoleId });
    await changeLog.record({
      userId,
      changedByUserId: auditCtx.adminUserId,
      changedByRole: 'admin',
      changeType: 'role',
      previousValue: oldRoleName,
      newValue: newRole.name,
      changeReason: 'Rol actualizado por administrador'
    });

    // Los JWT vigentes llevan el rol anterior: se invalidan para que el nuevo surta efecto de inmediato
    await guards.invalidateSessions(userId, 'role_changed');

    await audit.record('INTERNAL_USER_ROLE_CHANGED', {
      actorId: auditCtx.adminUserId,
      details: { before: { role: oldRoleName }, after: { role: newRole.name } },
      entityId: userId,
      ...ENTITY
    });

    const nombre = displayName(user);
    setImmediate(() => {
      const logoUrl = policy.notificationLogoUrl;
      notifier
        .notify({
          type: 'IAM_INTERNAL_USER_ROLE_CHANGED',
          userId,
          relatedEntity: { type: 'User', id: userId },
          metadata: { nombre, rolAnterior: oldRoleName || '—', nuevoRol: newRole.name, logoUrl }
        })
        .catch(err => logger.warn('Error enviando IAM_INTERNAL_USER_ROLE_CHANGED', { error: err.message }));
      notifier
        .notify({
          type: 'IAM_ADMIN_ROLE_CHANGED',
          userId: auditCtx.adminUserId,
          relatedEntity: { type: 'User', id: userId },
          metadata: { nombreUsuario: nombre, rolAnterior: oldRoleName || '—', nuevoRol: newRole.name, logoUrl }
        })
        .catch(err => logger.warn('Error enviando IAM_ADMIN_ROLE_CHANGED', { error: err.message }));
    });

    return InternalUserDTO(await users.findProfile(userId));
  }
}

export class ChangeInternalRole {
  constructor(private readonly deps: AccessDeps & { executeRoleChange: ExecuteInternalRoleChange }) {}

  async execute(userId: string, newRoleId: string, auditCtx: AdminContext) {
    const { guards, approvals, executeRoleChange } = this.deps;
    const user = await guards.getInternalUserOrFail(userId);
    assertNotDeleted(user);
    if (isSuperAdminRole(user.role?.name)) {
      throw new IamForbiddenError('No se puede cambiar el rol de un super administrador');
    }
    const newRole = await guards.getInternalRoleOrFail(newRoleId);
    if (user.roleId === newRoleId) {
      throw new IamInvalidInputError('El usuario ya tiene este rol');
    }

    // Doble aprobación: las validaciones corren ANTES del gate (una operación inviable nunca crea una solicitud)
    const gate = await approvals.gate('RBAC_ROLE_CHANGE', {
      entityType: 'User',
      entityId: userId,
      payload: { userId, roleId: newRoleId },
      ctx: auditCtx
    });
    if (gate.pending) {
      return { pending: true, approvalRequest: gate.request };
    }
    return executeRoleChange.execute(userId, newRoleId, auditCtx, { user, newRole });
  }
}

export class SetInternalUserStatus {
  constructor(private readonly deps: AccessDeps) {}

  async execute(userId: string, isActive: boolean, auditCtx: AdminContext) {
    const { users, changeLog, audit, notifier, logger, policy, guards } = this.deps;
    const user = await guards.getInternalUserOrFail(userId);
    assertNotDeleted(user);
    if (!isActive && isSuperAdminRole(user.role?.name)) {
      throw new IamForbiddenError('No se puede desactivar a un super administrador');
    }
    if (user.isActive === isActive) {
      throw new IamInvalidInputError(`El usuario ya está ${isActive ? 'activo' : 'inactivo'}`);
    }

    await users.update(userId, { isActive });
    await changeLog.record({
      userId,
      changedByUserId: auditCtx.adminUserId,
      changedByRole: 'admin',
      changeType: 'account_status',
      previousValue: user.isActive ? 'active' : 'inactive',
      newValue: isActive ? 'active' : 'inactive',
      changeReason: 'Estado de cuenta actualizado por administrador'
    });

    // Al desactivar se cierran sus sesiones de inmediato
    if (!isActive) {
      await guards.invalidateSessions(userId, 'account_deactivated');
    }

    await audit.record(isActive ? 'INTERNAL_USER_ACTIVATED' : 'INTERNAL_USER_DEACTIVATED', {
      actorId: auditCtx.adminUserId,
      details: { before: { isActive: !isActive }, after: { isActive } },
      entityId: userId,
      ...ENTITY
    });

    const nombre = displayName(user);
    const accion = isActive ? 'activado' : 'desactivado';
    setImmediate(() => {
      const logoUrl = policy.notificationLogoUrl;
      notifier
        .notify({
          type: isActive ? 'IAM_INTERNAL_USER_ACTIVATED' : 'IAM_INTERNAL_USER_DEACTIVATED',
          userId,
          relatedEntity: { type: 'User', id: userId },
          metadata: { nombre, logoUrl }
        })
        .catch(err => logger.warn(`Error enviando IAM_INTERNAL_USER_${isActive ? 'ACTIVATED' : 'DEACTIVATED'}`, { error: err.message }));
      notifier
        .notify({
          type: 'IAM_ADMIN_STATUS_CHANGED',
          userId: auditCtx.adminUserId,
          relatedEntity: { type: 'User', id: userId },
          metadata: { nombreUsuario: nombre, accion, logoUrl }
        })
        .catch(err => logger.warn('Error enviando IAM_ADMIN_STATUS_CHANGED', { error: err.message }));
    });

    return InternalUserDTO(await users.findProfile(userId));
  }
}

export class CloseInternalUserSessions {
  constructor(private readonly deps: AccessDeps) {}

  async execute(userId: string, auditCtx: AdminContext): Promise<InternalUserSessionsClosed> {
    const { audit, notifier, logger, guards } = this.deps;
    const user = await guards.getInternalUserOrFail(userId);
    assertNotDeleted(user);
    await guards.invalidateSessions(userId, 'closed_by_admin');
    await audit.record('INTERNAL_USER_SESSIONS_CLOSED', { actorId: auditCtx.adminUserId, details: { targetUserId: userId }, entityId: userId, ...ENTITY });

    const nombre = displayName(user);
    setImmediate(() => {
      notifier
        .notify({ type: 'IAM_INTERNAL_USER_SESSIONS_CLOSED', userId, relatedEntity: { type: 'User', id: userId }, metadata: { nombre } })
        .catch(err => logger.warn('Error enviando IAM_INTERNAL_USER_SESSIONS_CLOSED', { error: err.message }));
    });
    return { userId, closed: true };
  }
}

// ============================================================
// ELIMINACIÓN
// ============================================================

type DeletionDeps = Pick<IamDeps, 'users' | 'passwords' | 'anonymizer' | 'approvals' | 'unitOfWork' | 'audit' | 'notifier' | 'logger' | 'policy'> & {
  guards: InternalUserGuards;
};

/** La eliminación REAL (ofuscación + cierre de sesiones). La reanuda approvals al aprobarse (INTERNAL_USER_DELETE). */
export class ExecuteInternalUserDeletion {
  constructor(private readonly deps: DeletionDeps) {}

  async execute(userId: string, auditCtx: AdminContext): Promise<null> {
    const { users, anonymizer, unitOfWork, audit, notifier, logger, policy, guards } = this.deps;
    const user = await unitOfWork.run(async () => {
      const account = await users.findForAccountDeletion(userId);
      if (!account) {
        throw new UserNotFoundError();
      }
      const person = requirePerson(account);
      await anonymizer.anonymize({
        userId,
        personId: person.personId,
        nationalId: person.nationalId,
        email: person.contact?.email,
        username: account.username,
        firstName: person.firstName,
        changedBy: { userId: auditCtx.adminUserId, role: 'admin' },
        changeReason: 'Usuario interno eliminado por administrador'
      });
      return account;
    });

    // Tras el commit: cierra sesiones
    await guards.invalidateSessions(userId, 'account_deleted');

    await audit.record('INTERNAL_USER_DELETED', { actorId: auditCtx.adminUserId, entityId: userId, entityType: 'InternalUser', entityTable: 'users' });

    const empleadoNombre = user.person?.firstName || 'Usuario';
    setImmediate(() => {
      notifier
        .notify({
          type: 'IAM_ADMIN_STATUS_CHANGED',
          userId: auditCtx.adminUserId,
          relatedEntity: { type: 'User', id: userId },
          metadata: { nombreUsuario: empleadoNombre, accion: 'eliminado', logoUrl: policy.notificationLogoUrl }
        })
        .catch(err => logger.warn('Error enviando IAM_ADMIN_STATUS_CHANGED (eliminación)', { error: err.message }));
    });
    return null;
  }
}

export class DeleteInternalUser {
  constructor(private readonly deps: DeletionDeps & { executeDeletion: ExecuteInternalUserDeletion }) {}

  async execute(userId: string, currentPassword: string, auditCtx: AdminContext) {
    const { users, passwords, approvals, guards, executeDeletion } = this.deps;
    // Re-autenticación del admin (maker) ANTES del gate
    const adminUser = await users.findWithContact(auditCtx.adminUserId);
    if (!adminUser) {
      throw new IamNotFoundError('Administrador no encontrado');
    }
    if (!(await passwords.matches(currentPassword, adminUser.passwordHash))) {
      throw new IamInvalidInputError('Contraseña actual incorrecta');
    }

    // Un interno existente, no superadmin y no eliminado
    const user = await guards.getInternalUserOrFail(userId);
    assertNotDeleted(user);
    if (isSuperAdminRole(user.role?.name)) {
      throw new IamForbiddenError('No se puede eliminar a un super administrador');
    }

    const gate = await approvals.gate('INTERNAL_USER_DELETE', { entityType: 'User', entityId: userId, payload: { userId }, ctx: auditCtx });
    if (gate.pending) {
      return { pending: true, approvalRequest: gate.request };
    }
    await executeDeletion.execute(userId, auditCtx);
    return { userId, deleted: true } satisfies InternalUserDeleted;
  }
}
