// Lo que iam ofrece a los demás módulos: cuentas, roles y sesiones.
import { AccountDirectory, RoleDirectory, SessionDirectory } from './directories';
import { admin, ADMIN_ID, CLIENT_ID, iamWorld, PAGE, ROLES, session, user } from '../../../../../tests/doubles/iam.doubles';

describe('AccountDirectory', () => {
  it('resume, valida la contraseña y busca por username', async () => {
    const w = iamWorld();
    const accounts = new AccountDirectory(w);
    await expect(accounts.findSummary(CLIENT_ID)).resolves.toEqual({ userId: CLIENT_ID, username: 'user_ana', firstName: 'Ana' });
    await expect(accounts.findSummary('nadie')).resolves.toBeNull();
    await expect(accounts.passwordMatches(CLIENT_ID, 'Correcta#2026')).resolves.toBe(true);
    await expect(accounts.passwordMatches('nadie', 'Correcta#2026')).resolves.toBe(false);
    await expect(accounts.findUserIdByUsername('user_ana')).resolves.toBe(CLIENT_ID);
    await expect(accounts.findUserIdByUsername('x')).resolves.toBeNull();
  });

  it('crea con la contraseña hasheada y cambia la contraseña', async () => {
    const w = iamWorld();
    const accounts = new AccountDirectory(w);
    await accounts.create({ username: 'nuevo', authUsername: 'nuevo', personId: 'p-9', roleId: ROLES.CLIENTE.roleId, password: 'Clave#1' });
    expect(w.users.created[0]).toMatchObject({ username: 'nuevo', passwordHash: 'hash:Clave#1' });
    await accounts.setPassword(CLIENT_ID, 'Otra#2');
    expect(w.users.get(CLIENT_ID)?.passwordHash).toBe('hash:Otra#2');
  });

  it('el destinatario de un aviso lleva su email y teléfono', async () => {
    const accounts = new AccountDirectory(iamWorld());
    await expect(accounts.findRecipient(CLIENT_ID)).resolves.toEqual({
      userId: CLIENT_ID,
      isActive: true,
      email: 'ana@correo.co',
      phone: { number: '3001234567', prefixId: 'pp-57' }
    });
    await expect(accounts.findRecipient('nadie')).resolves.toBeNull();
  });

  it('el envío masivo solo recorre clientes activos, por páginas', async () => {
    const w = iamWorld([user(), user({ userId: 'u-z', isActive: false }), admin()]);
    const accounts = new AccountDirectory(w);
    await expect(accounts.activeClientsAfter(null, 10)).resolves.toEqual([{ userId: CLIENT_ID, email: 'ana@correo.co' }]);
    await expect(accounts.activeClientsAfter(CLIENT_ID, 10)).resolves.toEqual([]);
    await expect(accounts.activeUserIdsWithRoles(['ADMIN'])).resolves.toEqual([ADMIN_ID]);
  });
});

describe('RoleDirectory y SessionDirectory', () => {
  it('delegan en sus repositorios', async () => {
    const w = iamWorld();
    w.sessions.sessions = [session()];
    const roles = new RoleDirectory(w);
    const sessions = new SessionDirectory(w);
    await expect(roles.findByName('ADMIN')).resolves.toEqual(ROLES.ADMIN);
    await expect(roles.findByNames(['ADMIN', 'AUDITOR'])).resolves.toHaveLength(2);
    await expect(sessions.exists('s-1')).resolves.toBe(true);
    await expect(sessions.exists('nada')).resolves.toBe(false);
    await expect(sessions.list({ userId: CLIENT_ID }, { ...PAGE, offset: 0 })).resolves.toMatchObject({ count: 1 });
    await expect(sessions.devicesOfOwnSessions(['s-1'], 'u-otro')).resolves.toEqual([]);
  });
});
