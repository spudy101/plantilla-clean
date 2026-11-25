// Casos de uso: el usuario gestiona sus dispositivos de confianza (RF-AUTH-03): listar, ver los pendientes,
// renombrar, bloquear, desbloquear y aprobar. Bloquear, desbloquear y aprobar solo se puede desde un trusted.
import {
  assertActsFromTrusted,
  assertApprovable,
  assertBlockable,
  assertCanBlock,
  assertNotLastTrusted,
  assertUnblockable,
  requireDevice
} from '../../domain/trusted-device';
import authLoginDtoModule from '../dto/auth-login.output';
import type { IamDeps } from './iam-deps';

const { TrustedDeviceListDTO, TrustedDeviceUpdateDTO } = authLoginDtoModule;

type DeviceDeps = Pick<IamDeps, 'devices' | 'audit'>;

const deviceEntity = (deviceId: string) => ({ entityId: deviceId, entityType: 'UserTrustedDevice', entityTable: 'user_trusted_devices' });

// [RF-AUTH-03] | CA-01 | Dispositivos del usuario con navegador, SO, tipo, IP, ubicación, último acceso y si es el actual
export class ListTrustedDevices {
  constructor(private readonly deps: DeviceDeps) {}

  async execute(userId: string, currentFingerprintHash: string, currentSessionId: string | null = null) {
    const devices = await this.deps.devices.findAllByUserWithSessions(userId);
    await this.deps.audit.record('TRUSTED_DEVICES_VIEWED', {
      actorId: userId,
      details: { deviceCount: devices.length },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });
    return TrustedDeviceListDTO(devices, currentFingerprintHash, currentSessionId);
  }
}

export class ListPendingDevices {
  constructor(private readonly deps: DeviceDeps) {}

  async execute(userId: string) {
    const devices = await this.deps.devices.findAllPending(userId);
    await this.deps.audit.record('PENDING_DEVICES_VIEWED', {
      actorId: userId,
      details: { deviceCount: devices.length },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });
    return TrustedDeviceListDTO(devices, null);
  }
}

export class RenameDevice {
  constructor(private readonly deps: DeviceDeps) {}

  async execute(userId: string, deviceId: string, deviceName: string) {
    requireDevice(await this.deps.devices.findByIdAndUser(deviceId, userId));
    const updated = await this.deps.devices.rename(deviceId, deviceName);
    await this.deps.audit.record('TRUSTED_DEVICE_RENAMED', { actorId: userId, details: { newName: deviceName }, ...deviceEntity(deviceId) });
    return TrustedDeviceUpdateDTO(updated);
  }
}

/** Bloquea un dispositivo (trusted o pending). Siempre debe quedar al menos uno trusted. */
export class BlockDevice {
  constructor(private readonly deps: Pick<IamDeps, 'devices' | 'deviceBlocklist' | 'audit' | 'logger'>) {}

  async execute(userId: string, deviceId: string, currentFingerprintHash: string) {
    const { devices, deviceBlocklist, audit, logger } = this.deps;
    const currentDevice = await devices.findByFingerprint(userId, currentFingerprintHash);
    assertActsFromTrusted(currentDevice, 'bloquear');
    assertCanBlock(currentDevice, deviceId);

    const targetDevice = requireDevice(await devices.findByIdAndUser(deviceId, userId));
    assertBlockable(targetDevice);
    if (targetDevice.status === 'trusted') {
      assertNotLastTrusted(await devices.countTrusted(userId));
    }

    // Se registra desde qué dispositivo de confianza se bloqueó
    const updated = await devices.block(deviceId, currentDevice.userTrustedDeviceId);

    // Invalidación inmediata: el access token no se puede revocar, así que la huella bloqueada se escribe en Redis
    // para que la autenticación lo rechace en el próximo request (TTL de 1 h: no se conoce el exp del token activo)
    deviceBlocklist.block(userId, targetDevice.fingerprintHash).catch(err =>
      logger.warn('Error escribiendo blocklist en Redis tras blockDevice', {
        error: err.message,
        userId,
        deviceId,
        fingerprintHash: targetDevice.fingerprintHash
      })
    );

    await audit.record('TRUSTED_DEVICE_BLOCKED', {
      actorId: userId,
      details: { blockedByDeviceId: currentDevice.userTrustedDeviceId },
      ...deviceEntity(deviceId)
    });
    return TrustedDeviceUpdateDTO(updated);
  }
}

/** Desbloquea un dispositivo BLOCKED → vuelve a PENDING (requiere aprobación de un trusted para operar). */
export class UnblockDevice {
  constructor(private readonly deps: Pick<IamDeps, 'devices' | 'deviceBlocklist' | 'audit' | 'logger'>) {}

  async execute(userId: string, deviceId: string, currentFingerprintHash: string) {
    const { devices, deviceBlocklist, audit, logger } = this.deps;
    const currentDevice = await devices.findByFingerprint(userId, currentFingerprintHash);
    assertActsFromTrusted(currentDevice, 'desbloquear');

    const targetDevice = requireDevice(await devices.findByIdAndUser(deviceId, userId));
    assertUnblockable(targetDevice);

    const updated = await devices.unblock(deviceId);

    // Si la clave sigue en Redis (el token original no expiró), se borra para que pueda operar apenas lo aprueben
    deviceBlocklist.unblock(userId, targetDevice.fingerprintHash).catch(err =>
      logger.warn('Error eliminando blocklist en Redis tras unblockDevice', {
        error: err.message,
        userId,
        deviceId,
        fingerprintHash: targetDevice.fingerprintHash
      })
    );

    await audit.record('TRUSTED_DEVICE_UNBLOCKED', {
      actorId: userId,
      details: { unblockedByDeviceId: currentDevice.userTrustedDeviceId },
      ...deviceEntity(deviceId)
    });
    return TrustedDeviceUpdateDTO(updated);
  }
}

/** Aprueba un dispositivo PENDING → TRUSTED. */
export class ApproveDevice {
  constructor(private readonly deps: DeviceDeps) {}

  async execute(userId: string, deviceId: string, currentFingerprintHash: string) {
    const { devices, audit } = this.deps;
    const currentDevice = await devices.findByFingerprint(userId, currentFingerprintHash);
    assertActsFromTrusted(currentDevice, 'aprobar');

    const pendingDevice = requireDevice(await devices.findByIdAndUser(deviceId, userId));
    assertApprovable(pendingDevice);

    const approved = await devices.approve(deviceId, currentDevice.userTrustedDeviceId);
    await audit.record('TRUSTED_DEVICE_APPROVED', {
      actorId: userId,
      details: { approvedByDeviceId: currentDevice.userTrustedDeviceId },
      ...deviceEntity(deviceId)
    });
    return TrustedDeviceUpdateDTO(approved);
  }
}
