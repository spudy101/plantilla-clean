// Puerto: los dispositivos de confianza (tabla user_trusted_devices). El secreto HMAC lo genera el adaptador al
// crear el dispositivo y se guarda cifrado.
import type { NewTrustedDevice, TrustedDevice, TrustedDeviceWithLastSession } from '../../domain/trusted-device';

export interface TrustedDeviceRepository {
  findById(deviceId: string): Promise<TrustedDevice | null>;
  /** El del usuario con esa huella, cualquiera sea su estado. */
  findByFingerprint(userId: string, fingerprintHash: string): Promise<TrustedDevice | null>;
  /** El primero con esa huella, de cualquier usuario (la firma HMAC solo trae el X-Device-Id). */
  findAnyByFingerprint(fingerprintHash: string): Promise<TrustedDevice | null>;
  findByIdAndUser(deviceId: string, userId: string): Promise<TrustedDevice | null>;
  findByIds(ids: readonly string[]): Promise<TrustedDevice[]>;
  findAllByUserWithSessions(userId: string): Promise<TrustedDeviceWithLastSession[]>;
  findAllPending(userId: string): Promise<TrustedDevice[]>;
  countTrusted(userId: string): Promise<number>;

  create(device: NewTrustedDevice): Promise<TrustedDevice>;
  approve(deviceId: string, approvedByDeviceId: string): Promise<TrustedDevice>;
  block(deviceId: string, blockedByDeviceId: string): Promise<TrustedDevice>;
  /** Vuelve a pending y limpia el bloqueo. */
  unblock(deviceId: string): Promise<TrustedDevice>;
  rename(deviceId: string, deviceName: string): Promise<TrustedDevice>;
  updateLastSeen(userId: string, fingerprintHash: string): Promise<number>;
  deleteAllByUser(userId: string): Promise<number>;
}
