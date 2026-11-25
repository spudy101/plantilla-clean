// Adaptadores de los puertos de entorno con la infraestructura compartida: la lectura de errores de AWS, el tope
// por minuto de los envíos masivos (Redis), el cifrado de contactos, la transacción en curso, la generación de
// códigos OTP y la verificación de la firma SNS del feed de rebotes.
import crypto from 'node:crypto';
import redisClient from '../../../../shared/infrastructure/cache/redis.util';
import constantsModule from '../../../../shared/infrastructure/config';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
import txContext from '../../../../shared/infrastructure/database/transaction-context';
import EncryptionUtil from '../../../../shared/infrastructure/security/encryption.util';
import awsProviderMetaUtilModule from '../../../../shared/infrastructure/providers/aws-provider-meta.util';
import awsErrorCodesModule from '../../../../shared/infrastructure/providers/aws-error-codes';
import snsSignatureUtilModule from '../../../../shared/infrastructure/security/sns-signature.util';
import type SnsSignature from '../../../../shared/infrastructure/security/sns-signature.util';
import type { ProviderErrorClassifier, SendRateLimiter } from '../../application/ports/channel-gateways.port';
import type { BounceFeedVerifier, ContactCipher, TransactionProbe, VerificationCodeGenerator } from '../../application/ports/runtime.port';
import { MOCK_VERIFICATION_CODE, VERIFICATION_CODE_RANGE } from '../../domain/verification-code';

const { notifications, MOCKS } = constantsModule;
const { logger } = loggerUtilModule;
const { awsErrorCode } = awsProviderMetaUtilModule;
const { isHardBounce, isEndpointDisabled } = awsErrorCodesModule;
const { verifySnsSignature, confirmSnsSubscription } = snsSignatureUtilModule;

export const awsErrorClassifier: ProviderErrorClassifier = {
  /** El `name` del error del SDK (p. ej. MessageRejected); un Error genérico no trae código. */
  codeOf(error) {
    const code = awsErrorCode(error);
    return code === null || code === 'Error' ? null : String(code);
  },
  isHardBounce: (channel, code) => isHardBounce(channel, code),
  isEndpointDisabled: code => isEndpointDisabled(code)
};

const ONE_MINUTE_MS = 60 * 1000;
/** El contador de un minuto vive un poco más que el minuto. */
const COUNTER_TTL_SECONDS = 120;

/**
 * Ventana fija por minuto: cada tanda suma su tamaño al contador del minuto con un INCRBY atómico de Redis (varias
 * instancias comparten el tope sin pisarse). Si el total pasa el tope, espera al minuto siguiente y vuelve a pedir
 * lugar. Sin Redis, el contador es de este proceso (correcto con una sola instancia).
 */
export class RedisSendRateLimiter implements SendRateLimiter {
  private local = new Map<'sns' | 'ses', { key: string; total: number }>();

  acquire(provider: 'push' | 'email', amount: number): Promise<void> {
    return provider === 'push'
      ? this.take('sns', amount, notifications.rateLimits.snsPerMinute)
      : this.take('ses', amount, notifications.rateLimits.sesPerMinute);
  }

  private async take(provider: 'sns' | 'ses', amount: number, limitPerMinute: number): Promise<void> {
    if (amount <= 0) {
      return;
    }
    for (;;) {
      const now = Date.now();
      const key = `aws_${provider}_rate:${Math.floor(now / ONE_MINUTE_MS)}`;
      const total = await this.increment(provider, key, amount);
      // Cabe, o es la primera tanda del minuto (una tanda más grande que el tope igual tiene que salir).
      if (total <= limitPerMinute || total === amount) {
        return;
      }
      const waitTime = ONE_MINUTE_MS - (now % ONE_MINUTE_MS);
      logger.warn(`Rate limit ${provider.toUpperCase()} alcanzado, esperando ${waitTime}ms`, { total, limitPerMinute });
      await new Promise(resolve => {
        setTimeout(resolve, waitTime);
      });
    }
  }

  private async increment(provider: 'sns' | 'ses', key: string, amount: number): Promise<number> {
    const shared = await redisClient.incrBy(key, amount, COUNTER_TTL_SECONDS);
    if (shared !== null) {
      return shared;
    }
    const current = this.local.get(provider);
    const total = (current?.key === key ? current.total : 0) + amount;
    this.local.set(provider, { key, total });
    return total;
  }
}

export const contactCipher: ContactCipher = {
  // Los datos cifrados tienen formato GCM (ivHex:authTagHex:cipherHex); lo que ya está en claro queda igual.
  reveal: value => EncryptionUtil.safeDecrypt(value),
  hash: value => EncryptionUtil.generateHash(value)
};

export const transactionProbe: TransactionProbe = {
  inTransaction: () => txContext.activeUnit() !== null
};

/** Con proveedores simulados el código es fijo (no hay SMS ni email real para leerlo). */
export const verificationCodeGenerator: VerificationCodeGenerator = {
  next: () => (MOCKS.EXTERNAL_PROVIDERS ? MOCK_VERIFICATION_CODE : crypto.randomInt(VERIFICATION_CODE_RANGE.min, VERIFICATION_CODE_RANGE.max).toString())
};

export const snsBounceFeedVerifier: BounceFeedVerifier = {
  verify: message => verifySnsSignature(message as SnsSignature.Message),
  confirmSubscription: async message => {
    await confirmSnsSubscription(message as SnsSignature.Message);
  }
};
