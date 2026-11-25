// API pública del módulo notification para el módulo que todavía no está en Clean Architecture (iam) y para los
// adaptadores de src/main/.
//
// En Clean, notification no se usa importando este index: src/main/container.ts arma el módulo
// (createNotificationModule en notification.module.ts) y los módulos migrados avisan por el puerto Notifier. Lo
// que queda acá es TRANSITORIO: mandar notificaciones y SMS, los códigos OTP con los que iam verifica contactos,
// la preferencia inicial del registro y los dispositivos push del login. Cuando esos módulos se migren, pedirán lo
// suyo con un puerto propio y esto se borra.
//
// Cada pieza se carga al usarse (getter): los módulos se usan entre sí y un index que cargara todo de una vez
// crearía ciclos de carga.
import { interopDefault } from '../../shared/kernel/interop.util';
import type { PrismaNotificationPreferenceRepository } from './infrastructure/persistence/prisma-preference.repository';
import type { PrismaPushTokenRepository } from './infrastructure/persistence/prisma-push-token.repository';
import type { PrismaSmsAttemptRepository } from './infrastructure/persistence/prisma-sms-attempt.repository';
import type { PrismaVerificationCodeRepository } from './infrastructure/persistence/prisma-verification-code.repository';
import type { PrismaNotificationTypeRepository } from './infrastructure/persistence/prisma-notification-catalog.repositories';
import type { SnsPushGateway } from './infrastructure/providers/sns-push.gateway';

/** Una instancia de la clase exportada `name`; si el módulo está reemplazado por un jest.mock (objeto plano), el mock. */
function instanceOf<T>(mod: unknown, name: string): T {
  const Ctor = (mod as Record<string, unknown>)[name];
  return (typeof Ctor === 'function' ? new (Ctor as new () => T)() : mod) as T;
}

/** Una instancia por pieza, creada al primer uso. */
const instances = new Map<string, unknown>();
function lazy<T>(key: string, create: () => T): T {
  if (!instances.has(key)) {
    instances.set(key, create());
  }
  return instances.get(key) as T;
}

export default {
  /** @deprecated Transitorio para iam: notifier.notify({ type, userId, metadata }) / notifier.notifyEmail({ type, email }). */
  get notifier() {
    return interopDefault(require('./infrastructure/legacy/notifier') as typeof import('./infrastructure/legacy/notifier'));
  },

  /** @deprecated Transitorio para iam (MFA por SMS y challenge de login): enviarSmsOtp y resolveE164. */
  get SmsService() {
    return interopDefault(require('./infrastructure/legacy/sms-service') as typeof import('./infrastructure/legacy/sms-service'));
  },

  /** @deprecated Transitorio para iam (OTP de registro, MFA y login) y person (contactos verificados). */
  get verificationCodeRepository(): PrismaVerificationCodeRepository {
    return lazy('verificationCodes', () => instanceOf(require('./infrastructure/persistence/prisma-verification-code.repository'), 'PrismaVerificationCodeRepository'));
  },

  /** @deprecated Transitorio para iam (preferencia inicial del registro) y audit (traza de sesión). */
  get notificationPreferenceRepository(): Pick<PrismaNotificationPreferenceRepository, 'upsert' | 'findByIds'> {
    return lazy('preferences', () => instanceOf(require('./infrastructure/persistence/prisma-preference.repository'), 'PrismaNotificationPreferenceRepository'));
  },

  /** @deprecated Transitorio para iam (dispositivo push del login). */
  get userPushTokenRepository(): Pick<PrismaPushTokenRepository, 'upsertToken'> {
    return lazy('pushTokens', () => instanceOf(require('./infrastructure/persistence/prisma-push-token.repository'), 'PrismaPushTokenRepository'));
  },

  /** @deprecated Transitorio para iam: registrarDispositivo(token, plataforma, userId) → EndpointArn. */
  get pushNotificationService() {
    const gateway = lazy('pushGateway', () =>
      instanceOf<SnsPushGateway>(
        require('./infrastructure/providers/sns-push.gateway') as typeof import('./infrastructure/providers/sns-push.gateway'),
        'SnsPushGateway'
      )
    );
    return { registrarDispositivo: (deviceToken: string, platform: string, userId: string) => gateway.registerDevice(deviceToken, platform, userId) };
  },

  /** Para el catálogo público de tipos (catalogs, por src/main/adapters). */
  get notificationTypeRepository(): Pick<PrismaNotificationTypeRepository, 'list'> {
    return lazy('types', () =>
      instanceOf(
        require('./infrastructure/persistence/prisma-notification-catalog.repositories') as typeof import('./infrastructure/persistence/prisma-notification-catalog.repositories'),
        'PrismaNotificationTypeRepository'
      )
    );
  },

  /** Intentos de SMS fallidos en una ventana (integration, por src/main/adapters). */
  get smsDeliveryAttemptRepository(): Pick<PrismaSmsAttemptRepository, 'countFailedBetween'> {
    return lazy('smsAttempts', () => instanceOf(require('./infrastructure/persistence/prisma-sms-attempt.repository'), 'PrismaSmsAttemptRepository'));
  }
};
