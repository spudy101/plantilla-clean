// Retención (tareas diarias del worker): notificaciones leídas antiguas, dispositivos push inactivos y códigos
// de verificación vencidos o ya usados.
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { PersonalNotificationRepository } from '../ports/inbox-repository.port';
import type { PushTokenRepository } from '../ports/push-token-repository.port';
import type { VerificationCodeRepository } from '../ports/verification-code-repository.port';

const { errorMessage } = errorMessageModule;

const DEFAULT_NOTIFICATION_RETENTION_DAYS = 90;
const DEFAULT_CODE_RETENTION_DAYS = 30;

export class PurgeOldNotifications {
  constructor(
    private readonly personal: Pick<PersonalNotificationRepository, 'deleteReadOlderThan'>,
    private readonly pushTokens: Pick<PushTokenRepository, 'deleteInactiveOlderThan'>,
    private readonly logger: Logger
  ) {}

  async execute(days = DEFAULT_NOTIFICATION_RETENTION_DAYS) {
    try {
      const notificacionesEliminadas = await this.personal.deleteReadOlderThan(days);
      const tokensEliminados = await this.pushTokens.deleteInactiveOlderThan(days);
      this.logger.info('Limpieza completada', { notificacionesEliminadas, tokensEliminados });
      return { notificacionesEliminadas, tokensEliminados };
    } catch (error) {
      this.logger.warn('Error en limpieza', { error: errorMessage(error) });
      throw error;
    }
  }
}

export class PurgeVerificationCodes {
  constructor(
    private readonly codes: Pick<VerificationCodeRepository, 'deleteExpired' | 'deleteOldVerified'>,
    private readonly logger: Logger
  ) {}

  async execute(retentionDays = DEFAULT_CODE_RETENTION_DAYS) {
    const expiradosEliminados = await this.codes.deleteExpired();
    const verificadosEliminados = await this.codes.deleteOldVerified(retentionDays);
    this.logger.info('Limpieza de codigos de verificacion completada', {
      expiradosEliminados,
      verificadosEliminados,
      retencionDias: retentionDays
    });
    return { expiradosEliminados, verificadosEliminados };
  }
}
