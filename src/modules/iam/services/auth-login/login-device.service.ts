import type { UserWith } from '../../repositories/user.repository';
import type { UserTrustedDevice } from '../../../../shared/infrastructure/database/generated/prisma/client';
// modules/shared-endpoints/kyc/iam/services/auth-login/login-device.service.ts
//
// Resolución del dispositivo durante el login: primer dispositivo, dispositivo
// conocido o nuevo pendiente de aprobación. Extraído de AuthLoginService (SOLID: S).

import type { RequestAuditContext } from '../../../../shared/application/audit-context';
import trustedDeviceRepository from '../../repositories/auth-trusted-device.repository';
import DeviceFingerprintUtil from '../../../../shared/infrastructure/security/device-fingerprint.util';
import notificationModule from '../../../notification';
const { notifier } = notificationModule;
import AppError from '../../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../../shared/infrastructure/config';
const { notifications } = constantsModule;
import auditModule from '../../../audit';
const { audit } = auditModule;

class LoginDeviceService {
  trustedDeviceRepository: typeof trustedDeviceRepository;
  notifier: typeof notifier;

  /**
   * @param {object} [deps] Dependencias inyectables (SOLID: D). Las provee la fachada
   *   AuthLoginService; por defecto se usan las implementaciones reales.
   */
  constructor(deps: LoginDeviceService.Deps = {}) {
    this.trustedDeviceRepository = deps.trustedDeviceRepository ?? trustedDeviceRepository;
    this.notifier = deps.notifier ?? notifier;
  }

  /**
   * Maneja el ciclo de vida del dispositivo en cada login.
   * Corre síncronamente — su resultado puede bloquear el login.
   *
   * Retorna:
   *   { requiresApproval: false, deviceId }  → login puede continuar
   *   { requiresApproval: true,  deviceId }  → login bloqueado
   *
   * @private
   */
  // [RF-AUTH-03] | CA-03 | Detecta si el dispositivo es nuevo por fingerprint hash.
  // Dispositivo conocido desde IP/ubicación distinta no genera alerta (decisión técnica:
  // evitar ruido por VPNs y roaming)
  async handleTrustedDevice(user: UserWith<'login'>, auditContext: RequestAuditContext) {
    const { ip = null, userAgent = null, fingerprintHash } = auditContext;
    // audit.middleware siempre la calcula; sin ella la consulta fallaba con WHERE undefined
    if (!fingerprintHash) {
      throw AppError.badRequest('No se pudo identificar el dispositivo');
    }

    // ── ¿El dispositivo ya existe? ───────────────────────────
    const existing = await this.trustedDeviceRepository.findByFingerprint(user.userId, fingerprintHash);
    if (existing) {
      return this._handleExistingDevice(user.userId, fingerprintHash, existing);
    }

    // ── Dispositivo nuevo ────────────────────────────────────
    const enriched = DeviceFingerprintUtil.enrichDevice(userAgent, ip);
    const trustedCount = await this.trustedDeviceRepository.countTrusted(user.userId);
    const isFirstDevice = trustedCount === 0;

    if (isFirstDevice) {
      return this._registerFirstDevice(user, fingerprintHash, ip, enriched);
    }

    return this._registerPendingDevice(user, fingerprintHash, ip, enriched);
  }

  /** @private */
  async _handleExistingDevice(userId: string, fingerprintHash: string, existing: UserTrustedDevice) {
    if (existing.status === 'blocked') {
      // Evento forense de seguridad (Opción A): política de dispositivo bloqueado.
      // Se mantiene pese al log genérico del middleware al propagar el throw.
      await audit.record('LOGIN_BLOCKED_DEVICE', {
        actorId: userId,
        entityId: existing.userTrustedDeviceId,
        entityType: 'UserTrustedDevice',
        entityTable: 'userTrustedDevices',
        outcome: 'failure'
      });
      throw AppError.forbidden('Este dispositivo ha sido bloqueado. Desbloquéalo desde otro dispositivo de confianza.');
    }

    // trusted o pending → puede loguearse, actualiza last_seen
    await this.trustedDeviceRepository.updateLastSeen(userId, fingerprintHash);
    return {
      requiresApproval: false,
      deviceId: existing.userTrustedDeviceId,
      deviceHmacSecret: existing.hmacSecret
    };
  }

  /** @private */
  // [RF-AUTH-03] | CA-03 | Primer dispositivo del usuario → trusted automático,
  // sin notificación (es el dispositivo de registro inicial)
  async _registerFirstDevice(
    user: UserWith<'login'>,
    fingerprintHash: string,
    ip: string | null,
    enriched: ReturnType<typeof DeviceFingerprintUtil.enrichDevice>
  ) {
    const { browser, os, deviceType, city, country, countryCode, deviceName } = enriched;

    const device = await this.trustedDeviceRepository.create({
      userId: user.userId,
      fingerprintHash: fingerprintHash,
      deviceName: deviceName,
      status: 'trusted',
      ipAddress: ip,
      browser,
      os,
      deviceType: deviceType,
      city,
      country,
      countryCode: countryCode,
      trustedAt: new Date(),
      lastSeenAt: new Date()
    });

    await audit.record('TRUSTED_DEVICE_ADDED_FIRST', {
      actorId: user.userId,
      details: { deviceName },
      entityId: user.userId,
      entityType: 'User',
      entityTable: 'users'
    });

    return {
      requiresApproval: false,
      deviceId: device.userTrustedDeviceId,
      deviceHmacSecret: device.hmacSecret
    };
  }

  /** @private */
  // [RF-AUTH-03] | CA-03 | Segundo dispositivo en adelante → status pending +
  // dispara NUEVO_DISPOSITIVO_DETECTADO (fire-and-forget)
  async _registerPendingDevice(
    user: UserWith<'login'>,
    fingerprintHash: string,
    ip: string | null,
    enriched: ReturnType<typeof DeviceFingerprintUtil.enrichDevice>
  ) {
    const { browser, os, deviceType, city, country, countryCode, deviceName } = enriched;

    const device = await this.trustedDeviceRepository.create({
      userId: user.userId,
      fingerprintHash: fingerprintHash,
      deviceName: deviceName,
      status: 'pending',
      ipAddress: ip,
      browser,
      os,
      deviceType: deviceType,
      city,
      country,
      countryCode: countryCode,
      lastSeenAt: new Date()
    });

    await audit.record('TRUSTED_DEVICE_PENDING', {
      actorId: user.userId,
      details: {
        deviceName
      },
      entityId: device.userTrustedDeviceId,
      entityType: 'UserTrustedDevice',
      entityTable: 'user_trusted_devices'
    });

    // Notificación informativa (fire-and-forget — no bloquea el flujo)
    const firstName = user.person?.firstName || 'Usuario';
    const email = user.person?.contact?.email;

    this.notifier.notify({
      type: 'NUEVO_DISPOSITIVO_DETECTADO',
      userId: user.userId,
      relatedEntity: null,
      metadata: {
        nombre: firstName,
        email,
        ip,
        browser: browser || 'Desconocido',
        os: os || 'Desconocido',
        ciudad: city || 'Desconocida',
        pais: country || 'Desconocido',
        deviceName,
        fechaAcceso: new Date().toISOString(),
        logoUrl: notifications.ses.logoUrl
      }
    }).catch(err => logger.warn('Error sending new device notification', { error: err.message }));

    return {
      requiresApproval: false,
      deviceId: device.userTrustedDeviceId,
      deviceHmacSecret: device.hmacSecret
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace LoginDeviceService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    trustedDeviceRepository?: typeof trustedDeviceRepository;
    notifier?: typeof notifier;
  }
}

export default LoginDeviceService;
