// Gestión de usuarios internos (RF-ADM-01): lecturas, alta como AUDITOR, edición de nombres, cambio de rol y
// eliminación con doble aprobación, activar / desactivar y cierre de sesiones.
import {
  ChangeInternalRole,
  CloseInternalUserSessions,
  CreateInternalUser,
  DeleteInternalUser,
  ExecuteInternalRoleChange,
  ExecuteInternalUserDeletion,
  GetInternalUser,
  InternalUserGuards,
  ListDeletedInternalUsers,
  ListInternalRoleOptions,
  ListInternalUserChangeLogs,
  ListInternalUsers,
  ListInternalUserSessions,
  SetInternalUserStatus,
  UpdateInternalUser
} from './internal-users.use-cases';
import { IamForbiddenError, IamInternalError, IamInvalidInputError, IamNotFoundError, UserDeletedError, UserNotFoundError } from '../../domain/errors';
import {
  ADMIN_CTX,
  ADMIN_ID,
  admin,
  iamWorld,
  PAGE,
  ROLES,
  session,
  settle,
  STAFF_ID,
  staff,
  SUPER_ID,
  superadmin,
  user
} from '../../../../../tests/doubles/iam.doubles';
import type { UserProfile } from '../../domain/user';

function setup(users: UserProfile[] = [admin(), staff(), superadmin(), user()]) {
  const w = iamWorld(users);
  const deps = { ...w, guards: new InternalUserGuards(w) };
  const executeRoleChange = new ExecuteInternalRoleChange(deps);
  const executeDeletion = new ExecuteInternalUserDeletion(deps);
  return {
    w,
    deps,
    executeRoleChange,
    executeDeletion,
    changeRole: new ChangeInternalRole({ ...deps, executeRoleChange }),
    remove: new DeleteInternalUser({ ...deps, executeDeletion })
  };
}

describe('lecturas', () => {
  it('el listado muestra internos no superadmin, sin el propio admin, con el badge de pendientes, y audita', async () => {
    const { w, deps } = setup();
    w.approvals.pending.set(STAFF_ID, { approvalRequestId: 'ar-1' });
    const result = await new ListInternalUsers(deps).execute({ ...PAGE, isActive: true }, ADMIN_ID);

    expect(w.users.lists[0]!.filters).toEqual({ roleIds: [ROLES.ADMIN.roleId, ROLES.AUDITOR.roleId], excludeUserId: ADMIN_ID, isActive: true });
    expect(result.data.map(u => u?.userId)).toEqual([STAFF_ID]);
    expect(result.data[0]).toMatchObject({ roleName: 'AUDITOR', pendingApproval: { approvalRequestId: 'ar-1' } });
    expect(result.metadata).toMatchObject({ pagination: { totalItems: 1 }, filters: { isActive: true } });
    expect(w.audit.find('INTERNAL_USER_LIST_VIEWED')).toMatchObject({ actorId: ADMIN_ID, details: { totalItems: 1 } });
  });

  it('un roleId interno filtra por ese rol; uno no interno cae a todos los listables', async () => {
    const { w, deps } = setup();
    await new ListInternalUsers(deps).execute({ ...PAGE, roleId: ROLES.AUDITOR.roleId }, ADMIN_ID);
    await new ListInternalUsers(deps).execute({ ...PAGE, roleId: ROLES.CLIENTE.roleId }, ADMIN_ID);
    expect(w.users.lists.map(l => l.filters.roleIds)).toEqual([[ROLES.AUDITOR.roleId], [ROLES.ADMIN.roleId, ROLES.AUDITOR.roleId]]);
  });

  it('el histórico lista solo los eliminados', async () => {
    const { w, deps } = setup([admin(), staff({ deletedAt: new Date(), isActive: false })]);
    const result = await new ListDeletedInternalUsers(deps).execute(PAGE, ADMIN_ID);
    expect(w.users.lists[0]!.filters).toMatchObject({ onlyDeleted: true });
    expect(result.data.map(u => u?.userId)).toEqual([STAFF_ID]);
    expect(w.audit.actions()).toEqual(['INTERNAL_USER_DELETED_LIST_VIEWED']);
  });

  it('las opciones de rol son los internos sin superadmin', async () => {
    const { deps } = setup();
    await expect(new ListInternalRoleOptions(deps).execute(ADMIN_ID)).resolves.toEqual([
      { roleId: ROLES.ADMIN.roleId, name: 'ADMIN', description: 'Rol ADMIN' },
      { roleId: ROLES.AUDITOR.roleId, name: 'AUDITOR', description: 'Rol AUDITOR' }
    ]);
  });

  it('el detalle es solo de internos: un cliente o un id desconocido es 404', async () => {
    const { w, deps } = setup();
    await expect(new GetInternalUser(deps).execute(STAFF_ID, ADMIN_ID)).resolves.toMatchObject({ userId: STAFF_ID });
    expect(w.audit.find('INTERNAL_USER_VIEWED')).toMatchObject({ details: { targetUserId: STAFF_ID } });
    await expect(new GetInternalUser(deps).execute('u-cliente', ADMIN_ID)).rejects.toThrow(new IamNotFoundError('Usuario interno no encontrado'));
    await expect(new GetInternalUser(deps).execute('nadie', ADMIN_ID)).rejects.toThrow(UserNotFoundError);
  });

  it('sesiones activas y bitácora de un interno', async () => {
    const { w, deps } = setup();
    w.sessions.sessions = [session({ userId: STAFF_ID }), session({ userSessionId: 's-2', userId: STAFF_ID, status: 'closed' })];
    await expect(new ListInternalUserSessions(deps).execute(STAFF_ID, ADMIN_ID)).resolves.toHaveLength(1);
    const logs = await new ListInternalUserChangeLogs(deps).execute(STAFF_ID, PAGE, ADMIN_ID);
    expect(logs).toMatchObject({ data: [], metadata: { pagination: { totalItems: 0 } } });
    expect(w.audit.actions()).toEqual(['INTERNAL_USER_SESSIONS_VIEWED', 'INTERNAL_USER_CHANGE_LOGS_VIEWED']);
  });
});

describe('CreateInternalUser', () => {
  const DATA = { email: 'pedro@empresa.co', firstName: 'Pedro', lastName: 'Ruiz', nationalId: 'PEDRO0001' };

  it('nace AUDITOR con documento SYSTEM, valida unicidad, audita, avisa y devuelve la contraseña temporal', async () => {
    const { w, deps } = setup();
    const result = await new CreateInternalUser(deps).execute(DATA, ADMIN_CTX);
    await settle();

    expect(w.holders.created[0]).toMatchObject({ holder: { firstName: 'Pedro', nationalId: 'PEDRO0001', documentTypeId: 'dt-system' }, contact: { email: DATA.email } });
    expect(w.users.created[0]).toMatchObject({ username: 'staff_uuid-1', roleId: ROLES.AUDITOR.roleId, passwordHash: 'hash:Temp#Pass12' });
    expect(result).toMatchObject({ temporaryPassword: 'Temp#Pass12', role: { name: 'AUDITOR' } });
    expect(w.unitOfWork.runs).toBe(1);
    expect(w.audit.find('INTERNAL_USER_CREATED')).toMatchObject({ actorId: ADMIN_ID, details: { roleName: 'AUDITOR' } });
    expect(w.notifier.sent.map(n => [n.type, n.userId])).toEqual([
      ['IAM_INTERNAL_USER_CREATED', result.userId],
      ['IAM_ADMIN_USER_CREATED', ADMIN_ID]
    ]);
    expect(w.notifier.sent[0]!.metadata).toMatchObject({ passwordTemporal: 'Temp#Pass12' });
  });

  it('documento o email tomados → 409 antes de crear nada', async () => {
    const { w, deps } = setup();
    w.identity.takenNationalIds.add('PEDRO0001');
    await expect(new CreateInternalUser(deps).execute(DATA, ADMIN_CTX)).rejects.toThrow('El número de documento ya está registrado');
    w.identity.takenNationalIds.clear();
    w.identity.takenEmails.add(DATA.email);
    await expect(new CreateInternalUser(deps).execute(DATA, ADMIN_CTX)).rejects.toThrow('El email ya está registrado');
    expect(w.unitOfWork.runs).toBe(0);
  });

  it('sin el rol AUDITOR o sin el tipo SYSTEM es un error interno (falta el seeder)', async () => {
    const { w, deps } = setup();
    w.catalogs.systemDocumentType = null;
    await expect(new CreateInternalUser(deps).execute(DATA, ADMIN_CTX)).rejects.toThrow("Tipo de documento 'SYSTEM' no encontrado. Ejecuta el seeder de tipos de documento.");
    w.roles.roles = w.roles.roles.filter(r => r.name !== 'AUDITOR');
    await expect(new CreateInternalUser(deps).execute(DATA, ADMIN_CTX)).rejects.toThrow('Rol AUDITOR no encontrado. Ejecuta el seeder RBAC.');
  });

  it('una falla inesperada al crear revierte y responde un error interno', async () => {
    const { w, deps } = setup();
    w.holders.failWith = new Error('db caída');
    await expect(new CreateInternalUser(deps).execute(DATA, ADMIN_CTX)).rejects.toThrow(new IamInternalError('Error al crear el usuario interno. Intenta nuevamente'));
    expect(w.unitOfWork.rollbacks).toBe(1);
  });
});

describe('UpdateInternalUser', () => {
  it('cambia los nombres de la persona y audita el diff', async () => {
    const { w, deps } = setup();
    await new UpdateInternalUser(deps).execute(STAFF_ID, { firstName: 'Laurita' }, ADMIN_CTX);
    expect(w.holders.nameUpdates).toEqual([{ personId: 'p-laura', names: { firstName: 'Laurita', middleName: null, lastName: 'Gómez', secondLastName: null } }]);
    expect(w.audit.find('INTERNAL_USER_UPDATED')).toMatchObject({ entityTable: 'persons', details: { before: { firstName: 'Laura' }, after: { firstName: 'Laurita' } } });
  });

  it('una cuenta eliminada es intocable (409)', async () => {
    const { deps } = setup([staff({ deletedAt: new Date() })]);
    await expect(new UpdateInternalUser(deps).execute(STAFF_ID, { firstName: 'x' }, ADMIN_CTX)).rejects.toThrow(UserDeletedError);
  });
});

describe('ChangeInternalRole', () => {
  it('valida antes del gate: superadmin intocable, mismo rol, rol inexistente o no interno', async () => {
    const { w, changeRole } = setup();
    await expect(changeRole.execute(SUPER_ID, ROLES.ADMIN.roleId, ADMIN_CTX)).rejects.toThrow(new IamForbiddenError('No se puede cambiar el rol de un super administrador'));
    await expect(changeRole.execute(STAFF_ID, ROLES.AUDITOR.roleId, ADMIN_CTX)).rejects.toThrow('El usuario ya tiene este rol');
    await expect(changeRole.execute(STAFF_ID, 'role-x', ADMIN_CTX)).rejects.toThrow(new IamNotFoundError('Rol no encontrado'));
    await expect(changeRole.execute(STAFF_ID, ROLES.CLIENTE.roleId, ADMIN_CTX)).rejects.toThrow(new IamInvalidInputError('El rol indicado no es un rol interno'));
    expect(w.approvals.gated).toHaveLength(0);
  });

  it('con la doble aprobación pendiente responde la solicitud sin cambiar nada', async () => {
    const { w, changeRole } = setup();
    w.approvals.result = { pending: true, request: { approvalRequestId: 'ar-1' } };
    await expect(changeRole.execute(STAFF_ID, ROLES.ADMIN.roleId, ADMIN_CTX)).resolves.toEqual({ pending: true, approvalRequest: { approvalRequestId: 'ar-1' } });
    expect(w.approvals.gated).toEqual([
      { operationKey: 'RBAC_ROLE_CHANGE', input: { entityType: 'User', entityId: STAFF_ID, payload: { userId: STAFF_ID, roleId: ROLES.ADMIN.roleId }, ctx: ADMIN_CTX } }
    ]);
    expect(w.users.get(STAFF_ID)?.roleId).toBe(ROLES.AUDITOR.roleId);
  });

  it('sin aprobación pendiente cambia el rol, registra la bitácora, cierra sus sesiones y avisa a los dos', async () => {
    const { w, changeRole } = setup();
    w.sessions.sessions = [session({ userId: STAFF_ID })];
    const result = await changeRole.execute(STAFF_ID, ROLES.ADMIN.roleId, ADMIN_CTX);
    await settle();
    expect(result).toMatchObject({ userId: STAFF_ID });
    expect(w.users.get(STAFF_ID)?.role?.name).toBe('ADMIN');
    expect(w.changeLog.changes).toEqual([expect.objectContaining({ changeType: 'role', previousValue: 'AUDITOR', newValue: 'ADMIN', changedByUserId: ADMIN_ID })]);
    expect(w.sessions.get('s-1')).toMatchObject({ status: 'closed', closeReason: 'role_changed' });
    expect(w.revocations.invalidatedUsers.has(STAFF_ID)).toBe(true);
    expect(w.audit.find('INTERNAL_USER_ROLE_CHANGED')).toMatchObject({ details: { before: { role: 'AUDITOR' }, after: { role: 'ADMIN' } } });
    expect(w.notifier.sent.map(n => [n.type, n.userId])).toEqual([
      ['IAM_INTERNAL_USER_ROLE_CHANGED', STAFF_ID],
      ['IAM_ADMIN_ROLE_CHANGED', ADMIN_ID]
    ]);
  });

  it('approvals reanuda el cambio sin volver a pasar por el gate', async () => {
    const { w, executeRoleChange } = setup();
    await executeRoleChange.execute(STAFF_ID, ROLES.ADMIN.roleId, ADMIN_CTX);
    expect(w.approvals.gated).toHaveLength(0);
    expect(w.users.get(STAFF_ID)?.roleId).toBe(ROLES.ADMIN.roleId);
  });
});

describe('SetInternalUserStatus', () => {
  it('no desactiva a un superadmin ni repite el estado actual', async () => {
    const { deps } = setup();
    await expect(new SetInternalUserStatus(deps).execute(SUPER_ID, false, ADMIN_CTX)).rejects.toThrow('No se puede desactivar a un super administrador');
    await expect(new SetInternalUserStatus(deps).execute(STAFF_ID, true, ADMIN_CTX)).rejects.toThrow('El usuario ya está activo');
  });

  it('desactivar cierra sus sesiones, registra la bitácora, audita y avisa', async () => {
    const { w, deps } = setup();
    w.sessions.sessions = [session({ userId: STAFF_ID })];
    await new SetInternalUserStatus(deps).execute(STAFF_ID, false, ADMIN_CTX);
    await settle();
    expect(w.users.get(STAFF_ID)?.isActive).toBe(false);
    expect(w.changeLog.changes[0]).toMatchObject({ changeType: 'account_status', previousValue: 'active', newValue: 'inactive' });
    expect(w.sessions.get('s-1')).toMatchObject({ status: 'closed', closeReason: 'account_deactivated' });
    expect(w.audit.actions()).toEqual(['INTERNAL_USER_DEACTIVATED']);
    expect(w.notifier.sent.map(n => n.type)).toEqual(['IAM_INTERNAL_USER_DEACTIVATED', 'IAM_ADMIN_STATUS_CHANGED']);
    expect(w.notifier.sent[1]!.metadata).toMatchObject({ nombreUsuario: 'Laura Gómez', accion: 'desactivado' });
  });

  it('activar no toca las sesiones', async () => {
    const { w, deps } = setup([admin(), staff({ isActive: false })]);
    await new SetInternalUserStatus(deps).execute(STAFF_ID, true, ADMIN_CTX);
    expect(w.sessions.bulkCloses).toHaveLength(0);
    expect(w.audit.actions()).toEqual(['INTERNAL_USER_ACTIVATED']);
  });
});

describe('CloseInternalUserSessions', () => {
  it('cierra e invalida sus sesiones, audita y avisa', async () => {
    const { w, deps } = setup();
    w.sessions.sessions = [session({ userId: STAFF_ID })];
    await expect(new CloseInternalUserSessions(deps).execute(STAFF_ID, ADMIN_CTX)).resolves.toEqual({ userId: STAFF_ID, closed: true });
    await settle();
    expect(w.sessions.get('s-1')).toMatchObject({ status: 'closed', closeReason: 'closed_by_admin' });
    expect(w.audit.actions()).toEqual(['INTERNAL_USER_SESSIONS_CLOSED']);
    expect(w.notifier.sent.map(n => n.type)).toEqual(['IAM_INTERNAL_USER_SESSIONS_CLOSED']);
  });
});

describe('DeleteInternalUser', () => {
  it('re-autentica al admin: inexistente 404, contraseña incorrecta 400', async () => {
    const { remove } = setup();
    await expect(remove.execute(STAFF_ID, 'Admin#2026', { ...ADMIN_CTX, adminUserId: 'nadie' })).rejects.toThrow('Administrador no encontrado');
    await expect(remove.execute(STAFF_ID, 'mala', ADMIN_CTX)).rejects.toThrow('Contraseña actual incorrecta');
  });

  it('no elimina a un superadmin ni a una cuenta ya eliminada', async () => {
    const { remove } = setup([admin(), superadmin(), staff({ deletedAt: new Date() })]);
    await expect(remove.execute(SUPER_ID, 'Admin#2026', ADMIN_CTX)).rejects.toThrow('No se puede eliminar a un super administrador');
    await expect(remove.execute(STAFF_ID, 'Admin#2026', ADMIN_CTX)).rejects.toThrow(UserDeletedError);
  });

  it('con la doble aprobación pendiente no elimina', async () => {
    const { w, remove } = setup();
    w.approvals.result = { pending: true, request: { approvalRequestId: 'ar-2' } };
    await expect(remove.execute(STAFF_ID, 'Admin#2026', ADMIN_CTX)).resolves.toEqual({ pending: true, approvalRequest: { approvalRequestId: 'ar-2' } });
    expect(w.approvals.gated[0]).toMatchObject({ operationKey: 'INTERNAL_USER_DELETE' });
    expect(w.anonymizer.anonymized).toHaveLength(0);
  });

  it('sin aprobación pendiente ofusca la cuenta en una transacción, cierra sus sesiones y avisa al admin', async () => {
    const { w, remove } = setup();
    w.sessions.sessions = [session({ userId: STAFF_ID })];
    await expect(remove.execute(STAFF_ID, 'Admin#2026', ADMIN_CTX)).resolves.toEqual({ userId: STAFF_ID, deleted: true });
    await settle();
    expect(w.unitOfWork.runs).toBe(1);
    expect(w.anonymizer.anonymized).toEqual([
      {
        userId: STAFF_ID,
        personId: 'p-laura',
        nationalId: 'LAURA0001',
        email: 'ana@correo.co',
        username: 'staff_laura',
        firstName: 'Laura',
        changedBy: { userId: ADMIN_ID, role: 'admin' },
        changeReason: 'Usuario interno eliminado por administrador'
      }
    ]);
    expect(w.sessions.get('s-1')).toMatchObject({ status: 'closed', closeReason: 'account_deleted' });
    expect(w.audit.actions()).toEqual(['INTERNAL_USER_DELETED']);
    expect(w.notifier.sent).toEqual([expect.objectContaining({ type: 'IAM_ADMIN_STATUS_CHANGED', userId: ADMIN_ID, metadata: expect.objectContaining({ accion: 'eliminado' }) })]);
  });

  it('la ejecución reanudada revierte si la cuenta ya no existe', async () => {
    const { w, executeDeletion } = setup();
    await expect(executeDeletion.execute('nadie', ADMIN_CTX)).rejects.toThrow(UserNotFoundError);
    expect(w.unitOfWork.rollbacks).toBe(1);
    expect(w.audit.entries).toHaveLength(0);
  });
});
