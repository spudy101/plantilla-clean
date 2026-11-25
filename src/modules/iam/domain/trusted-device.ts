// Dispositivos de confianza (user_trusted_devices). Cada login resuelve el suyo por la huella del navegador /
// app: el primero entra como trusted, los siguientes como pending hasta que uno trusted los apruebe. Un trusted
// puede bloquear, desbloquear y aprobar a los demás; siempre debe quedar al menos uno trusted.
import { DeviceNotFoundError, IamForbiddenError, IamInvalidInputError } from './errors';

export type DeviceStatus = 'pending' | 'trusted' | 'blocked';

export interface TrustedDevice {
  userTrustedDeviceId: string;
  userId: string;
  fingerprintHash: string;
  deviceName: string;
  status: string;
  ipAddress: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  browser: string | null;
  os: string | null;
  deviceType: string;
  hmacSecret: string | null;
  approvedByDeviceId: string | null;
  approvedAt: Date | null;
  blockedByDeviceId: string | null;
  blockedAt: Date | null;
  trustedAt: Date | null;
  lastSeenAt: Date;
  originSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** El dispositivo con su última sesión (activa o cerrada), para la vista "Mis dispositivos". */
export interface TrustedDeviceWithLastSession extends TrustedDevice {
  sessions: Array<{
    userSessionId: string;
    status: string;
    ipAddress: string | null;
    userAgent: string | null;
    startedAt: Date;
    lastAccessAt: Date;
    closedAt: Date | null;
    closeReason: string | null;
  }>;
}

/** Un dispositivo nuevo: el secreto HMAC lo genera quien lo guarda. */
export interface NewTrustedDevice {
  userId: string;
  fingerprintHash: string;
  deviceName: string;
  status: DeviceStatus;
  ipAddress: string | null;
  browser?: string | null;
  os?: string | null;
  deviceType?: string | null;
  city?: string | null;
  country?: string | null;
  countryCode?: string | null;
  trustedAt?: Date | null;
  lastSeenAt: Date;
}

/** Lo que se deduce del user-agent y la IP de un dispositivo nuevo. */
export interface DeviceDescription {
  browser: string | null;
  os: string | null;
  deviceType: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  deviceName: string;
}

type Action = 'bloquear' | 'desbloquear' | 'aprobar';

/** Solo un dispositivo TRUSTED gestiona a los demás. */
export function assertActsFromTrusted(current: Pick<TrustedDevice, 'status'> | null, action: Action): asserts current is TrustedDevice {
  if (!current || current.status !== 'trusted') {
    throw new IamForbiddenError(`Solo puedes ${action} dispositivos desde un dispositivo de confianza`);
  }
}

export function requireDevice<D>(device: D | null): D {
  if (!device) {
    throw new DeviceNotFoundError();
  }
  return device;
}

/** Bloquear: no a sí mismo, no uno ya bloqueado y nunca el último trusted. */
export function assertCanBlock(current: Pick<TrustedDevice, 'userTrustedDeviceId'>, deviceId: string): void {
  if (current.userTrustedDeviceId === deviceId) {
    throw new IamInvalidInputError('No puedes bloquear tu propio dispositivo. Usa el endpoint de logout');
  }
}

export function assertBlockable(target: Pick<TrustedDevice, 'status'>): void {
  if (target.status === 'blocked') {
    throw new IamInvalidInputError('El dispositivo ya está bloqueado');
  }
}

export function assertNotLastTrusted(trustedCount: number): void {
  if (trustedCount <= 1) {
    throw new IamInvalidInputError('No puedes bloquear el único dispositivo de confianza. Promueve otro dispositivo primero');
  }
}

export function assertUnblockable(target: Pick<TrustedDevice, 'status'>): void {
  if (target.status !== 'blocked') {
    throw new IamInvalidInputError('El dispositivo no está bloqueado');
  }
}

export function assertApprovable(target: Pick<TrustedDevice, 'status'>): void {
  if (target.status !== 'pending') {
    throw new IamInvalidInputError('El dispositivo no está pendiente de aprobación');
  }
}
