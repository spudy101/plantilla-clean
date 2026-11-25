// Lo que otros módulos usan de notification (por los adaptadores de src/main/), además del puerto Notifier:
//
//   OtpCodes                    los códigos OTP: el email verificado antes del registro y los retos de MFA y de login
//                               por SMS de iam; los contactos confirmados de person
//   RegisterPushDevice          el dispositivo push del login mobile (iam)
//   CreateDefaultPreference     la preferencia inicial del usuario nuevo (el registro de iam)
//   FindPreferencesByIds        las preferencias que muestra la traza de una sesión (audit)
//   ListNotificationTypeEntries el catálogo público de tipos (catalogs)
//   CountFailedSms              los SMS fallidos durante una caída del proveedor (integration)
//
// No se auditan: los pide otro módulo como parte de una operación que ya audita la suya.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { VerificationCodeType } from '../../domain/verification-code';
import type { PushGateway, SmsAttemptLog } from '../ports/channel-gateways.port';
import type { NotificationTypeFilters, NotificationTypeRepository } from '../ports/notification-catalog-repository.port';
import type { NotificationPreferenceRepository } from '../ports/preference-repository.port';
import type { PushTokenRepository } from '../ports/push-token-repository.port';
import type { NewVerificationCode, VerificationCodeRepository } from '../ports/verification-code-repository.port';

export class OtpCodes {
  constructor(private readonly codes: VerificationCodeRepository) {}

  secondsUntilNewCode(type: VerificationCodeType, contactValue: string) {
    return this.codes.secondsUntilNewCode(type, contactValue);
  }

  create(code: NewVerificationCode) {
    return this.codes.create(code);
  }

  /** El último vigente y sin verificar. */
  findActive(type: VerificationCodeType, contactValue: string) {
    return this.codes.findActiveByContact(type, contactValue);
  }

  async incrementAttempts(verificationCodeId: string): Promise<void> {
    await this.codes.incrementAttempts(verificationCodeId);
  }

  async markAsVerified(verificationCodeId: string): Promise<void> {
    await this.codes.markAsVerified(verificationCodeId);
  }

  async isVerified(type: VerificationCodeType, contactValue: string): Promise<boolean> {
    return (await this.codes.findVerifiedByContact(type, contactValue)) !== null;
  }

  async consumeVerified(type: VerificationCodeType, contactValue: string): Promise<void> {
    await this.codes.deleteVerifiedByContact(type, contactValue);
  }
}

export class RegisterPushDevice {
  constructor(
    private readonly push: Pick<PushGateway, 'registerDevice'>,
    private readonly pushTokens: Pick<PushTokenRepository, 'upsertToken'>
  ) {}

  /** El token FCM se registra en el proveedor (devuelve su endpoint) y se asocia al usuario. */
  async execute({ userId, token, platform, deviceId }: { userId: string; token: string; platform: string; deviceId: string | null }) {
    const endpointArn = await this.push.registerDevice(token, platform, userId);
    if (!endpointArn) {
      // El proveedor no devolvió el endpoint: no hay nada que guardar
      throw new Error('SNS no devolvió EndpointArn');
    }
    await this.pushTokens.upsertToken(userId, endpointArn, platform, deviceId);
  }
}

export class CreateDefaultPreference {
  constructor(private readonly preferences: Pick<NotificationPreferenceRepository, 'upsert'>) {}

  /** Todos los canales, sin horario de silencio. */
  async execute(userId: string): Promise<void> {
    await this.preferences.upsert(userId, { allowPush: true, allowEmail: true, allowSms: true, quietHoursStart: null, quietHoursEnd: null });
  }
}

export class FindPreferencesByIds {
  constructor(private readonly preferences: Pick<NotificationPreferenceRepository, 'findByIds'>) {}

  execute(ids: readonly string[]) {
    return this.preferences.findByIds(ids);
  }
}

export class ListNotificationTypeEntries {
  constructor(private readonly types: Pick<NotificationTypeRepository, 'list'>) {}

  execute(filters: NotificationTypeFilters, page: PageRequest, search: string | null) {
    return this.types.list(filters, page, search);
  }
}

export class CountFailedSms {
  constructor(private readonly attempts: SmsAttemptLog) {}

  execute(from: Date | null, to: Date) {
    return this.attempts.countFailedBetween(from, to);
  }
}
