// Gestión de los dispositivos de confianza del propio usuario: listar, renombrar, bloquear, desbloquear y aprobar.
import { ApproveDevice, BlockDevice, ListPendingDevices, ListTrustedDevices, RenameDevice, UnblockDevice } from './trusted-devices.use-cases';
import { DeviceNotFoundError, IamForbiddenError } from '../../domain/errors';
import { CLIENT_ID, device, iamWorld, settle } from '../../../../../tests/doubles/iam.doubles';

/** El usuario está en dev-1 (trusted, fp-1); tiene dev-2 (trusted, fp-2) y dev-3 (pending, fp-3). */
function setup() {
  const w = iamWorld();
  w.devices.devices = [
    device({ userTrustedDeviceId: 'dev-1', fingerprintHash: 'fp-1' }),
    device({ userTrustedDeviceId: 'dev-2', fingerprintHash: 'fp-2' }),
    device({ userTrustedDeviceId: 'dev-3', fingerprintHash: 'fp-3', status: 'pending' }),
    device({ userTrustedDeviceId: 'dev-ajeno', fingerprintHash: 'fp-x', userId: 'u-otro' })
  ];
  return w;
}

describe('listados', () => {
  it('lista los dispositivos del usuario marcando el actual (por la huella), y audita', async () => {
    const w = setup();
    const result = await new ListTrustedDevices(w).execute(CLIENT_ID, 'fp-1');
    expect(result.total).toBe(3);
    expect(result.devices.find(d => d?.userTrustedDeviceId === 'dev-1')).toMatchObject({ isCurrent: true });
    expect(result.devices.find(d => d?.userTrustedDeviceId === 'dev-2')).toMatchObject({ isCurrent: false });
    expect(w.audit.find('TRUSTED_DEVICES_VIEWED')).toMatchObject({ details: { deviceCount: 3 } });
  });

  it('lista solo los pendientes', async () => {
    const w = setup();
    const result = await new ListPendingDevices(w).execute(CLIENT_ID);
    expect(result.devices.map(d => d?.userTrustedDeviceId)).toEqual(['dev-3']);
    expect(w.audit.find('PENDING_DEVICES_VIEWED')).toMatchObject({ details: { deviceCount: 1 } });
  });
});

describe('RenameDevice', () => {
  it('renombra uno propio y audita; uno ajeno es 404', async () => {
    const w = setup();
    await expect(new RenameDevice(w).execute(CLIENT_ID, 'dev-2', 'Mi portátil')).resolves.toMatchObject({ userTrustedDeviceId: 'dev-2', deviceName: 'Mi portátil' });
    expect(w.audit.find('TRUSTED_DEVICE_RENAMED')).toMatchObject({ entityId: 'dev-2', details: { newName: 'Mi portátil' } });
    await expect(new RenameDevice(w).execute(CLIENT_ID, 'dev-ajeno', 'x')).rejects.toThrow(DeviceNotFoundError);
  });
});

describe('BlockDevice', () => {
  it('bloquea desde un trusted: registra quién bloqueó, escribe la blocklist y audita', async () => {
    const w = setup();
    await expect(new BlockDevice(w).execute(CLIENT_ID, 'dev-2', 'fp-1')).resolves.toMatchObject({ status: 'blocked' });
    await settle();
    expect(w.devices.get('dev-2')).toMatchObject({ status: 'blocked', blockedByDeviceId: 'dev-1' });
    expect(await w.deviceBlocklist.isBlocked(CLIENT_ID, 'fp-2')).toBe(true);
    expect(w.audit.find('TRUSTED_DEVICE_BLOCKED')).toMatchObject({ entityId: 'dev-2', details: { blockedByDeviceId: 'dev-1' } });
  });

  it('un pending también se puede bloquear, aunque quede un solo trusted', async () => {
    const w = setup();
    w.devices.devices = w.devices.devices.filter(d => d.userTrustedDeviceId !== 'dev-2');
    await expect(new BlockDevice(w).execute(CLIENT_ID, 'dev-3', 'fp-1')).resolves.toMatchObject({ status: 'blocked' });
  });

  it('rechaza: desde un pending (403), el propio, uno ajeno y uno ya bloqueado', async () => {
    const w = setup();
    const block = new BlockDevice(w);
    await expect(block.execute(CLIENT_ID, 'dev-2', 'fp-3')).rejects.toThrow(IamForbiddenError);
    await expect(block.execute(CLIENT_ID, 'dev-1', 'fp-1')).rejects.toThrow('No puedes bloquear tu propio dispositivo. Usa el endpoint de logout');
    await expect(block.execute(CLIENT_ID, 'dev-ajeno', 'fp-1')).rejects.toThrow(DeviceNotFoundError);
    await block.execute(CLIENT_ID, 'dev-3', 'fp-1');
    await expect(block.execute(CLIENT_ID, 'dev-3', 'fp-1')).rejects.toThrow('El dispositivo ya está bloqueado');
  });

  it('antes de bloquear un trusted cuenta los trusted (nunca deja al usuario sin uno)', async () => {
    const w = setup();
    w.devices.countTrusted = async () => 1;
    await expect(new BlockDevice(w).execute(CLIENT_ID, 'dev-2', 'fp-1')).rejects.toThrow(
      'No puedes bloquear el único dispositivo de confianza. Promueve otro dispositivo primero'
    );
    expect(w.devices.get('dev-2')?.status).toBe('trusted');
  });
});

describe('UnblockDevice', () => {
  it('desbloquea (vuelve a pending), limpia la blocklist y audita', async () => {
    const w = setup();
    await new BlockDevice(w).execute(CLIENT_ID, 'dev-2', 'fp-1');
    await expect(new UnblockDevice(w).execute(CLIENT_ID, 'dev-2', 'fp-1')).resolves.toMatchObject({ status: 'pending' });
    await settle();
    expect(await w.deviceBlocklist.isBlocked(CLIENT_ID, 'fp-2')).toBe(false);
    expect(w.audit.find('TRUSTED_DEVICE_UNBLOCKED')).toMatchObject({ details: { unblockedByDeviceId: 'dev-1' } });
  });

  it('uno que no está bloqueado es 400; desde un pending es 403', async () => {
    const w = setup();
    await expect(new UnblockDevice(w).execute(CLIENT_ID, 'dev-2', 'fp-1')).rejects.toThrow('El dispositivo no está bloqueado');
    await expect(new UnblockDevice(w).execute(CLIENT_ID, 'dev-2', 'fp-3')).rejects.toThrow('Solo puedes desbloquear dispositivos desde un dispositivo de confianza');
  });
});

describe('ApproveDevice', () => {
  it('aprueba un pending (→ trusted) registrando desde cuál, y audita', async () => {
    const w = setup();
    await expect(new ApproveDevice(w).execute(CLIENT_ID, 'dev-3', 'fp-1')).resolves.toMatchObject({ status: 'trusted' });
    expect(w.devices.get('dev-3')).toMatchObject({ approvedByDeviceId: 'dev-1' });
    expect(w.audit.find('TRUSTED_DEVICE_APPROVED')).toMatchObject({ entityId: 'dev-3', details: { approvedByDeviceId: 'dev-1' } });
  });

  it('uno que no está pendiente es 400; desde un pending es 403', async () => {
    const w = setup();
    await expect(new ApproveDevice(w).execute(CLIENT_ID, 'dev-2', 'fp-1')).rejects.toThrow('El dispositivo no está pendiente de aprobación');
    await expect(new ApproveDevice(w).execute(CLIENT_ID, 'dev-3', 'fp-3')).rejects.toThrow('Solo puedes aprobar dispositivos desde un dispositivo de confianza');
  });
});
