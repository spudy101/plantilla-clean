// Casos de uso del panel de clientes (admin), con dobles en memoria de sus puertos.
import {
  GetClientAccount,
  ListClientAccounts,
  ListClientRoleOptions,
  ListDeletedClientAccounts
} from './client-account-queries.use-cases';
import { CreateClientAccount } from './create-client-account.use-case';
import { ChangeClientRole, SetClientAccountStatus } from './client-account-access.use-cases';
import { ChangeClientEmail, ChangeClientNationalId, DisableClientMfa, ResetClientPassword } from './client-account-credentials.use-cases';
import { ExecuteClientAccountDeletion, RequestClientAccountDeletion } from './client-account-deletion.use-cases';
import { IdentityChecks } from './identity-checks';
import { ChangeContactEmail } from './change-contact-email.use-case';
import { AnonymizeAccount } from './anonymize-account.use-case';
import {
  AccountDeletedError,
  AccountStatusUnchangedError,
  AdminNotFoundError,
  EmailTakenError,
  MfaNotEnabledError,
  NationalIdTakenError,
  NotAClientAccountError,
  NotAClientRoleError,
  RoleNotFoundError,
  UserNotFoundError,
  WrongCurrentPasswordError
} from '../../domain/errors';
import { RecordingAuditTrail, silentLogger } from '../../../../../tests/doubles/settings.doubles';
import { CountingUnitOfWork } from '../../../../../tests/doubles/legal.doubles';
import {
  ADMIN_CTX,
  ADMIN_ID,
  ADMIN_ROLE,
  CLIENT_ROLE,
  FakeApprovals,
  fixedIds,
  fixedPassword,
  flushNotices,
  InMemoryAccounts,
  InMemoryConsents,
  InMemoryContacts,
  InMemoryLocations,
  InMemoryPersons,
  InMemoryRoles,
  InMemoryVerifications,
  person,
  PERSON_ID,
  RecordingChangeLog,
  RecordingNotices,
  target,
  USER_ID
} from '../../../../../tests/doubles/person.doubles';

const PAGE = { page: 1, limit: 10, sortBy: 'createdAt', order: 'DESC' as const };
const VIP_ROLE = { roleId: 'role-vip', name: 'CLIENTE', description: 'Otro rol de cliente' };

function setup() {
  const audit = new RecordingAuditTrail();
  const unitOfWork = new CountingUnitOfWork();
  const accounts = new InMemoryAccounts();
  const roles = new InMemoryRoles();
  const persons = new InMemoryPersons();
  const contacts = new InMemoryContacts();
  const locations = new InMemoryLocations();
  const consents = new InMemoryConsents();
  const changeLog = new RecordingChangeLog();
  const notifier = new RecordingNotices();
  const approvals = new FakeApprovals();
  const notices = { notifier, logger: silentLogger, logoUrl: 'https://cdn.test/logo.png' };
  const identity = new IdentityChecks(persons, contacts);
  const changeEmail = new ChangeContactEmail(contacts, identity, new InMemoryVerifications(), changeLog, silentLogger);
  const anonymize = new AnonymizeAccount(persons, contacts, locations, accounts, consents, changeLog);
  const executeDeletion = new ExecuteClientAccountDeletion(unitOfWork, accounts, anonymize, audit, notices);
  return { audit, unitOfWork, accounts, roles, persons, contacts, locations, consents, changeLog, notifier, approvals, notices, identity, changeEmail, executeDeletion };
}

describe('consultas del panel', () => {
  it('el listado se limita a los roles de cliente (un roleId interno se ignora) y no devuelve el documento en la metadata', async () => {
    const s = setup();
    const result = await new ListClientAccounts(s.accounts, s.roles, s.audit).execute({
      actorId: ADMIN_ID,
      query: { ...PAGE, roleId: `${ADMIN_ROLE.roleId}, otro`, nationalId: '1020304050', search: 'ana' }
    });
    expect(s.accounts.lists[0]).toEqual({ filters: { isActive: undefined, roleIds: [CLIENT_ROLE.roleId], nationalId: '1020304050' }, search: 'ana' });
    expect(result.data[0]).toMatchObject({ userId: USER_ID, person: { nationalId: '******4050' }, email: expect.stringContaining('*'), emailVerified: true });
    expect(result.metadata.filters).toEqual({ search: 'ana', roleId: `${ADMIN_ROLE.roleId}, otro` });
    expect(s.audit.entries[0]).toMatchObject({ action: 'PERSON_LIST_VIEWED', details: { totalItems: 1, page: 1 } });
  });

  it('un roleId de cliente válido filtra por él', async () => {
    const s = setup();
    s.roles.roles.push(VIP_ROLE);
    await new ListClientAccounts(s.accounts, s.roles, s.audit).execute({ actorId: ADMIN_ID, query: { ...PAGE, roleId: VIP_ROLE.roleId, isActive: false } });
    expect(s.accounts.lists[0]?.filters).toEqual({ isActive: false, roleIds: [VIP_ROLE.roleId] });
  });

  it('eliminados: solo las cuentas con baja, de roles de cliente', async () => {
    const s = setup();
    await new ListDeletedClientAccounts(s.accounts, s.roles, s.audit).execute({ actorId: ADMIN_ID, query: PAGE });
    expect(s.accounts.lists[0]?.filters).toEqual({ roleIds: [CLIENT_ROLE.roleId], onlyDeleted: true });
    expect(s.audit.entries[0]?.action).toBe('PERSON_DELETED_LIST_VIEWED');
  });

  it('opciones de rol: solo los de cliente', async () => {
    const s = setup();
    expect(await new ListClientRoleOptions(s.roles, s.audit).execute({ actorId: ADMIN_ID })).toEqual([
      { roleId: CLIENT_ROLE.roleId, name: 'CLIENTE', description: 'Cliente' }
    ]);
    expect(s.audit.entries[0]).toMatchObject({ entityType: 'RbacRole', entityTable: 'roles' });
  });

  it('detalle: 404 si no existe', async () => {
    const s = setup();
    expect(await new GetClientAccount(s.accounts, s.audit).execute({ actorId: ADMIN_ID, userId: USER_ID })).toMatchObject({ user: { userId: USER_ID } });
    s.accounts.profile = null;
    await expect(new GetClientAccount(s.accounts, s.audit).execute({ actorId: ADMIN_ID, userId: USER_ID })).rejects.toThrow(UserNotFoundError);
  });
});

describe('CreateClientAccount', () => {
  const data = { email: 'nuevo@correo.co', firstName: 'Nuevo', lastName: 'Cliente', nationalId: '999888777', documentTypeId: 'dt-cc' };
  const create = (s: ReturnType<typeof setup>) =>
    new CreateClientAccount(s.unitOfWork, s.accounts, s.roles, s.persons, s.contacts, s.identity, fixedPassword, fixedIds, s.audit, s.notices);

  it('persona + contacto verificado + usuario con contraseña temporal, en una transacción', async () => {
    const s = setup();
    const result = await create(s).execute({ data, ctx: ADMIN_CTX });

    expect(s.unitOfWork.runs).toBe(1);
    expect(s.persons.persons.at(-1)).toMatchObject({ firstName: 'Nuevo', nationalId: '999888777', middleName: null, genderId: null });
    expect(s.contacts.contacts.at(-1)).toMatchObject({ email: 'nuevo@correo.co', emailVerifiedAt: expect.any(Date) });
    expect(s.accounts.created).toEqual([
      { username: 'user_uuid-fijo', authUsername: 'user_uuid-fijo', personId: 'p-2', roleId: CLIENT_ROLE.roleId, password: 'Temp#Pass12' }
    ]);
    expect(result.temporaryPassword).toBe('Temp#Pass12');
    expect(s.audit.entries[0]).toMatchObject({ action: 'PERSON_CREATED', entityId: 'u-nuevo', details: { roleName: 'CLIENTE' } });

    await flushNotices();
    expect(s.notifier.sent.map(n => n.type)).toEqual(['USUARIO_CREADO_ADMIN', 'PERSON_ADMIN_ACTION']);
    expect(s.notifier.sent[1]).toMatchObject({ userId: ADMIN_ID, metadata: { accion: 'crear', userId: 'u-nuevo' } });
  });

  it('documento o email de otra persona: 409 sin crear nada', async () => {
    const s = setup();
    await expect(create(s).execute({ data: { ...data, nationalId: person().nationalId as string }, ctx: ADMIN_CTX })).rejects.toThrow(NationalIdTakenError);
    await expect(create(s).execute({ data: { ...data, email: 'ana@correo.co' }, ctx: ADMIN_CTX })).rejects.toThrow(EmailTakenError);
    expect(s.accounts.created).toEqual([]);
  });
});

describe('estado y rol', () => {
  it('desactiva, registra el cambio, audita y avisa al titular y al admin', async () => {
    const s = setup();
    const result = await new SetClientAccountStatus(s.unitOfWork, s.accounts, s.changeLog, s.audit, s.notices, 'deactivate').execute({
      userId: USER_ID,
      ctx: ADMIN_CTX
    });
    expect(result).toEqual({ userId: USER_ID, username: 'ana', isActive: false, action: 'deactivate' });
    expect(s.accounts.writes).toEqual([{ op: 'active', userId: USER_ID, value: false }]);
    expect(s.changeLog.changes[0]).toMatchObject({ changedByUserId: ADMIN_ID, changedByRole: 'admin', previousValue: 'active', newValue: 'inactive' });
    expect(s.audit.entries[0]).toMatchObject({ action: 'PERSON_DEACTIVATED', details: { before: { isActive: true }, after: { isActive: false } } });
    await flushNotices();
    expect(s.notifier.sent.map(n => n.type)).toEqual(['ACCOUNT_DEACTIVATED', 'PERSON_ADMIN_ACTION']);
  });

  it('ya activa → 400; eliminada → 409; inexistente → 404', async () => {
    const s = setup();
    const activate = new SetClientAccountStatus(s.unitOfWork, s.accounts, s.changeLog, s.audit, s.notices, 'activate');
    await expect(activate.execute({ userId: USER_ID, ctx: ADMIN_CTX })).rejects.toThrow(AccountStatusUnchangedError);
    s.accounts.actionTarget = target({ deletedAt: new Date() });
    await expect(activate.execute({ userId: USER_ID, ctx: ADMIN_CTX })).rejects.toThrow(AccountDeletedError);
    s.accounts.actionTarget = null;
    await expect(activate.execute({ userId: USER_ID, ctx: ADMIN_CTX })).rejects.toThrow(UserNotFoundError);
  });

  it('cambia el rol entre roles de cliente', async () => {
    const s = setup();
    s.roles.roles.push(VIP_ROLE);
    const result = await new ChangeClientRole(s.unitOfWork, s.accounts, s.roles, s.changeLog, s.audit, s.notices).execute({
      userId: USER_ID,
      newRoleId: VIP_ROLE.roleId,
      ctx: ADMIN_CTX
    });
    expect(s.accounts.writes).toEqual([{ op: 'role', userId: USER_ID, value: VIP_ROLE.roleId }]);
    expect(result).toMatchObject({ oldRole: { roleId: CLIENT_ROLE.roleId }, newRole: { roleId: VIP_ROLE.roleId } });
  });

  it('una cuenta interna → 403 (antes de buscar el rol); un rol interno → 400; un rol inexistente → 404', async () => {
    const s = setup();
    const change = (newRoleId: string) =>
      new ChangeClientRole(s.unitOfWork, s.accounts, s.roles, s.changeLog, s.audit, s.notices).execute({ userId: USER_ID, newRoleId, ctx: ADMIN_CTX });
    await expect(change('no-existe')).rejects.toThrow(RoleNotFoundError);
    await expect(change(ADMIN_ROLE.roleId)).rejects.toThrow(NotAClientRoleError);
    s.accounts.actionTarget = target({ role: ADMIN_ROLE, roleId: ADMIN_ROLE.roleId });
    await expect(change('no-existe')).rejects.toThrow(NotAClientAccountError);
  });
});

describe('credenciales e identidad', () => {
  it('resetea la contraseña con una temporal y se la manda al titular', async () => {
    const s = setup();
    const result = await new ResetClientPassword(s.unitOfWork, s.accounts, fixedPassword, s.changeLog, s.audit, s.notices).execute({
      userId: USER_ID,
      ctx: ADMIN_CTX
    });
    expect(s.accounts.writes).toEqual([{ op: 'password', userId: USER_ID, value: 'Temp#Pass12' }]);
    expect(result).toEqual({ userId: USER_ID, username: 'ana', email: expect.stringContaining('*') });
    await flushNotices();
    expect(s.notifier.sent[0]).toMatchObject({ type: 'PASSWORD_RESET_ADMIN', metadata: { passwordTemporal: 'Temp#Pass12' } });
  });

  it('cambia el email sin OTP y avisa a la dirección vieja y a la nueva', async () => {
    const s = setup();
    const result = await new ChangeClientEmail(s.unitOfWork, s.accounts, s.changeEmail, s.audit, s.notices).execute({
      userId: USER_ID,
      newEmail: 'nueva@correo.co',
      ctx: ADMIN_CTX
    });
    expect(result).toMatchObject({ emailVerified: true });
    expect(s.changeLog.changes[0]).toMatchObject({ changedByRole: 'admin', changeReason: 'Email actualizado por administrador' });
    expect(s.audit.entries[0]?.details).toEqual({ before: { email: 'ana@correo.co' }, after: { email: 'nueva@correo.co' } });
    await flushNotices();
    expect(s.notifier.emails).toEqual([expect.objectContaining({ type: 'EMAIL_CHANGED_OLD', email: 'ana@correo.co' })]);
    expect(s.notifier.sent.map(n => n.type)).toEqual(['EMAIL_CHANGED_NEW', 'PERSON_ADMIN_ACTION']);
  });

  it('cambia el documento; con el mismo valor responde igual sin escribir, auditar ni avisar', async () => {
    const s = setup();
    const change = (newNationalId: string) =>
      new ChangeClientNationalId(s.unitOfWork, s.accounts, s.persons, s.identity, s.changeLog, s.audit, s.notices).execute({
        userId: USER_ID,
        newNationalId,
        ctx: ADMIN_CTX
      });

    expect(await change('1020304050')).toEqual({ userId: USER_ID, username: 'ana', oldNationalId: '******4050', newNationalId: '******4050' });
    expect(s.persons.updates).toEqual([]);
    expect(s.audit.entries).toEqual([]);

    await change('55554444');
    expect(s.persons.updates).toEqual([{ personId: PERSON_ID, changes: { nationalId: '55554444' } }]);
    expect(s.audit.entries[0]?.action).toBe('PERSON_NATIONAL_ID_CHANGED');
  });

  it('desactiva el MFA que tenga; sin MFA → 400', async () => {
    const s = setup();
    const disable = new DisableClientMfa(s.unitOfWork, s.accounts, s.changeLog, s.audit, s.notices);
    await expect(disable.execute({ userId: USER_ID, ctx: ADMIN_CTX })).rejects.toThrow(MfaNotEnabledError);

    s.accounts.actionTarget = target({ totpEnabled: true, preferredMfaMethod: 'totp' });
    const result = await disable.execute({ userId: USER_ID, ctx: ADMIN_CTX });
    expect(s.accounts.writes).toEqual([{ op: 'mfa', userId: USER_ID, value: { preferredMfaMethod: 'none', totpEnabled: false, clearTotpSecret: true } }]);
    expect(result).toEqual({ userId: USER_ID, username: 'ana', totpEnabled: false, smsMfaEnabled: false, preferredMfaMethod: 'none' });
  });
});

describe('baja con doble aprobación', () => {
  const request = (s: ReturnType<typeof setup>, currentPassword = 'Correcta#2026') =>
    new RequestClientAccountDeletion(s.accounts, s.approvals, s.executeDeletion).execute({ userId: USER_ID, currentPassword, ctx: ADMIN_CTX });

  it('pendiente: devuelve la solicitud y no elimina', async () => {
    const s = setup();
    s.approvals.result = { pending: true, request: { approvalRequestId: 'ar-1' } };
    expect(await request(s)).toEqual({ pending: true, approvalRequest: { approvalRequestId: 'ar-1' } });
    expect(s.approvals.gated).toEqual([
      { operationKey: 'CLIENT_ACCOUNT_DELETE', args: { entityType: 'User', entityId: USER_ID, payload: { userId: USER_ID }, ctx: ADMIN_CTX } }
    ]);
    expect(s.accounts.writes).toEqual([]);
  });

  it('sin segunda aprobación: elimina en el momento, audita y avisa', async () => {
    const s = setup();
    expect(await request(s)).toBeNull();
    expect(s.accounts.writes[0]).toMatchObject({ op: 'deleted' });
    expect(s.changeLog.changes[0]).toMatchObject({ changedByUserId: ADMIN_ID, changeReason: 'Cuenta eliminada por administrador' });
    expect(s.audit.entries[0]).toMatchObject({ action: 'PERSON_ACCOUNT_DELETED', actorId: ADMIN_ID, entityId: USER_ID });
    await flushNotices();
    expect(s.notifier.emails[0]).toMatchObject({ type: 'CUENTA_ELIMINADA', email: 'ana@correo.co', metadata: { logoUrl: 'https://cdn.test/logo.png' } });
    expect(s.notifier.sent[0]).toMatchObject({ type: 'PERSON_ADMIN_ACTION', metadata: { accion: 'eliminar_cuenta' } });
  });

  it('contraseña del admin equivocada → 400; sin admin → 404; cuenta ya eliminada → 409 (nada se gatea)', async () => {
    const s = setup();
    await expect(request(s, 'mala')).rejects.toThrow(WrongCurrentPasswordError);
    s.accounts.actionTarget = target({ deletedAt: new Date() });
    await expect(request(s)).rejects.toThrow(AccountDeletedError);
    s.accounts.profile = null;
    s.accounts.findSummary = async () => null;
    await expect(request(s)).rejects.toThrow(AdminNotFoundError);
    expect(s.approvals.gated).toEqual([]);
  });
});
