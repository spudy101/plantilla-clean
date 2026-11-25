// Adaptador AWS SNS del puerto PushGateway (APNS + GCM en un mismo mensaje) y el registro de dispositivos, que
// iam usa al iniciar sesión (por el index.ts transitorio). Cada llamada pasa por callProvider.
import {
  CreatePlatformEndpointCommand,
  GetEndpointAttributesCommand,
  PublishCommand,
  SNSClient,
  SetEndpointAttributesCommand
} from '@aws-sdk/client-sns';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
import constantsModule from '../../../../shared/infrastructure/config';
import { AWS_CLIENT_OPTIONS, callProvider } from '../../../../shared/infrastructure/providers/provider-call.util';
import { providerFailure } from '../../../../shared/infrastructure/providers/provider-errors';
import awsProviderMetaUtilModule from '../../../../shared/infrastructure/providers/aws-provider-meta.util';
import awsErrorCodesModule from '../../../../shared/infrastructure/providers/aws-error-codes';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import type { BulkPushResult, PushGateway, PushMessage } from '../../application/ports/channel-gateways.port';
import { UnsupportedPushPlatformError } from '../../domain/errors';

const { logger } = loggerUtilModule;
const { notifications, aws } = constantsModule;
const { awsErrorCode } = awsProviderMetaUtilModule;
const { isEndpointDisabled } = awsErrorCodesModule;
const { errorMessage } = errorMessageModule;

/** Lo único que se usa del cliente SNS (un doble de test solo necesita send). */
export type SnsSender = Pick<SNSClient, 'send'>;

/**
 * SNS rechaza CreatePlatformEndpoint si el token ya tiene endpoint con otros atributos (otro usuario en el mismo
 * dispositivo) y nombra ese endpoint en el mensaje: se reutiliza.
 */
const EXISTING_ENDPOINT_RE = /Endpoint (arn:aws:sns:\S+) already exists with the same [Tt]oken/;

/** El mensaje en el formato de iOS y Android. */
export function buildPushPayload(title: string, body: string, data: Record<string, unknown> = {}) {
  return {
    default: body,
    APNS: JSON.stringify({ aps: { alert: { title, body }, sound: 'default', badge: 1 }, data }),
    GCM: JSON.stringify({ notification: { title, body, sound: 'default' }, data })
  };
}

export class SnsPushGateway implements PushGateway {
  constructor(private client: SnsSender | null = null) {}

  /** Se crea al primer uso (la configuración de AWS puede no estar lista al cargar). */
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

  async sendToDevice(endpoint: string, { title, body, data }: PushMessage, notificationId: string | null = null): Promise<void> {
    try {
      const command = new PublishCommand({ TargetArn: endpoint, Message: JSON.stringify(buildPushPayload(title, body, data)), MessageStructure: 'json' });
      await callProvider({ product: 'sns', endpoint: 'SNS:PublishCommand', notificationId }, abortSignal => this.sns.send(command, { abortSignal }));
      logger.info('Push individual enviado exitosamente', { endpointArn: endpoint, title });
    } catch (error) {
      logger.warn('Error al enviar push individual', { error: errorMessage(error), endpointArn: endpoint });
      throw error;
    }
  }

  async sendToMany(endpoints: readonly string[], message: PushMessage): Promise<BulkPushResult> {
    try {
      const results = await Promise.all(
        endpoints.map(arn =>
          this.sendToDevice(arn, message)
            .then(() => ({ arn, success: true, disabled: false }))
            .catch((error: unknown) => ({ arn, success: false, disabled: isEndpointDisabled(awsErrorCode(error)) }))
        )
      );
      const stats = {
        success: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        disabledEndpoints: results.filter(r => r.disabled).map(r => r.arn)
      };
      logger.info('Push masivo completado', {
        success: stats.success,
        failed: stats.failed,
        disabled: stats.disabledEndpoints.length,
        total: endpoints.length,
        title: message.title
      });
      return stats;
    } catch (error) {
      logger.warn('Error al enviar push masivo', { error: errorMessage(error) });
      return { success: 0, failed: endpoints.length, disabledEndpoints: [] };
    }
  }

  /**
   * Registra un dispositivo: crea el endpoint (o reutiliza el que ya tiene ese token) y, si SNS lo dejó
   * deshabilitado o con otro token/usuario, lo actualiza y habilita (CreatePlatformEndpoint solo no lo rehabilita).
   * @returns el EndpointArn
   */
  async registerDevice(deviceToken: string, platform: string, userId: string): Promise<string | undefined> {
    // Antes del try: un error de plataforma es del cliente (400), no del proveedor.
    const platformArn = (
      { ios: notifications.sns.platformArnIos, android: notifications.sns.platformArnAndroid } as Record<string, string | undefined>
    )[platform.toLowerCase()];
    if (!platformArn) {
      throw new UnsupportedPushPlatformError(platform);
    }
    try {
      const endpointArn = await this.createEndpoint(platformArn, deviceToken, userId);
      if (endpointArn) {
        await this.enableEndpoint(endpointArn, deviceToken, userId);
      }
      logger.info('Dispositivo registrado exitosamente', { userId, platform, endpointArn });
      return endpointArn;
    } catch (error) {
      logger.warn('Error al registrar dispositivo', { error: errorMessage(error), userId, platform });
      throw providerFailure(error, 'Error al registrar dispositivo para notificaciones');
    }
  }

  private async createEndpoint(platformArn: string, deviceToken: string, userId: string): Promise<string | undefined> {
    const command = new CreatePlatformEndpointCommand({ PlatformApplicationArn: platformArn, Token: deviceToken, CustomUserData: userId });
    try {
      const response = await callProvider({ product: 'sns', endpoint: 'SNS:CreatePlatformEndpoint' }, abortSignal => this.sns.send(command, { abortSignal }));
      return response.EndpointArn;
    } catch (error) {
      const existing = awsErrorCode(error) === 'InvalidParameter' ? EXISTING_ENDPOINT_RE.exec(errorMessage(error)) : null;
      if (!existing) {
        throw error;
      }
      return existing[1];
    }
  }

  /** Lo deja habilitado, con el token y el usuario actuales (solo escribe si algo difiere). */
  private async enableEndpoint(endpointArn: string, deviceToken: string, userId: string): Promise<void> {
    const current = await callProvider({ product: 'sns', endpoint: 'SNS:GetEndpointAttributes' }, abortSignal =>
      this.sns.send(new GetEndpointAttributesCommand({ EndpointArn: endpointArn }), { abortSignal })
    );
    const attrs = current.Attributes ?? {};
    if (attrs.Enabled === 'true' && attrs.Token === deviceToken && attrs.CustomUserData === userId) {
      return;
    }
    await callProvider({ product: 'sns', endpoint: 'SNS:SetEndpointAttributes' }, abortSignal =>
      this.sns.send(
        new SetEndpointAttributesCommand({ EndpointArn: endpointArn, Attributes: { Token: deviceToken, CustomUserData: userId, Enabled: 'true' } }),
        { abortSignal }
      )
    );
    logger.info('Endpoint SNS rehabilitado', { endpointArn, wasEnabled: attrs.Enabled === 'true', userId });
  }
}
