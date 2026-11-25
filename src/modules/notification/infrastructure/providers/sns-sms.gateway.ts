// Adaptador AWS SNS del puerto SmsGateway (SMS transaccional / OTP). AWS es infraestructura fail-open: no se
// gatea por estado; el circuit breaker sobre el producto 'aws_sms' protege ante fallos de envío. Cada intento
// queda en sms_delivery_attempts (por phone_hash, sin el número en claro).
//
// Con los proveedores simulados (fuera de producción) no se llama a SNS: el intento se marca enviado.
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
import constantsModule from '../../../../shared/infrastructure/config';
import EncryptionUtil from '../../../../shared/infrastructure/security/encryption.util';
import { AWS_CLIENT_OPTIONS, CircuitOpenError, callProvider } from '../../../../shared/infrastructure/providers/provider-call.util';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import type { OutgoingSms, SmsGateway, SmsResult } from '../../application/ports/channel-gateways.port';
import type { PrismaSmsAttemptRepository } from '../persistence/prisma-sms-attempt.repository';
import type { SnsSender } from './sns-push.gateway';

const { logger } = loggerUtilModule;
const { MOCKS, aws } = constantsModule;
const { errorMessage } = errorMessageModule;

const PRODUCT = 'aws_sms';
const ENDPOINT = 'SNS:PublishCommand:SMS';

type Attempts = Pick<PrismaSmsAttemptRepository, 'createAttempt' | 'markSent' | 'markFailed'>;

export class SnsSmsGateway implements SmsGateway {
  constructor(
    private readonly attempts: Attempts,
    private client: SnsSender | null = null
  ) {}

  private get sns(): SnsSender {
    if (!this.client) {
      this.client = new SNSClient({
        ...AWS_CLIENT_OPTIONS,
        region: aws.region,
        credentials: { accessKeyId: aws.accessKeyId, secretAccessKey: aws.secretAccessKey }
      });
    }
    return this.client;
  }

  async send({ phoneNumber, message, userId = null, purpose }: OutgoingSms): Promise<SmsResult> {
    const attempt = await this.attempts.createAttempt({ userId, phoneHash: EncryptionUtil.generateHash(phoneNumber), provider: PRODUCT, purpose });
    const attemptId = attempt.smsDeliveryAttemptId;

    if (MOCKS.EXTERNAL_PROVIDERS) {
      logger.warn('[SMS] MODO MOCK ACTIVO — SMS no enviado realmente (OTP fijo en entornos no productivos)', { attemptId, purpose: attempt.purpose });
      await this.attempts.markSent(attemptId, { providerMessageId: `MOCK-${attemptId}` });
      return { success: true, attemptId, mock: true };
    }

    try {
      const response = await callProvider({ product: PRODUCT, endpoint: ENDPOINT }, abortSignal =>
        this.sns.send(
          new PublishCommand({
            Message: message,
            PhoneNumber: phoneNumber,
            MessageAttributes: { 'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' } }
          }),
          { abortSignal }
        )
      );
      await this.attempts.markSent(attemptId, { providerMessageId: response.MessageId || null });
      return { success: true, attemptId };
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        await this.attempts.markFailed(attemptId, { lastError: 'Circuit breaker abierto — SMS (AWS SNS) no disponible' });
        return { success: false, attemptId, error: 'Servicio SMS no disponible temporalmente', circuitOpen: true };
      }
      await this.attempts.markFailed(attemptId, { lastError: errorMessage(error) });
      return { success: false, attemptId, error: errorMessage(error), serviceUnavailable: true };
    }
  }
}
