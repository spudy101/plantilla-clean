import {
  SNSClient,
  CreatePlatformEndpointCommand,
  DeleteEndpointCommand,
  GetEndpointAttributesCommand,
  PublishCommand,
  SetEndpointAttributesCommand
} from '@aws-sdk/client-sns';
/** Lo único que se usa del cliente SNS (un doble de test solo necesita send). */
type SnsSender = Pick<InstanceType<typeof SNSClient>, 'send'>;
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import AppError from '../../../shared/presentation/http/app-error.util';
import constantsModule from '../../../shared/infrastructure/config';
const { notifications, aws } = constantsModule;
import { callProvider, AWS_CLIENT_OPTIONS } from '../../../shared/infrastructure/providers/provider-call.util';
import { providerFailure } from '../../../shared/infrastructure/providers/provider-errors';
import awsProviderMetaUtilModule from '../../../shared/infrastructure/providers/aws-provider-meta.util';
const { awsErrorCode } = awsProviderMetaUtilModule;
import awsErrorCodesModule from '../../../shared/infrastructure/providers/aws-error-codes';
const { isEndpointDisabled } = awsErrorCodesModule;
import errorMessageModule from '../../../shared/kernel/error-message.util';

const { errorMessage } = errorMessageModule;

/** SNS rechaza CreatePlatformEndpoint si el token ya tiene endpoint con otros atributos (otro usuario
 * en el mismo dispositivo) y nombra ese endpoint en el mensaje: lo reutilizamos. */
const EXISTING_ENDPOINT_RE = /Endpoint (arn:aws:sns:\S+) already exists with the same [Tt]oken/;

class PushNotificationService {
  _snsClient: SnsSender | null;
  declare _PLATFORM_ARNS?: { ios: string; android: string };

  /**
   * Dependencias inyectables (SOLID: D). Sin snsClient se crea el cliente real al primer uso.
   *   new PushNotificationService({ snsClient: fake })
   * @param {object} [deps]
   */
  constructor(deps: PushNotificationService.Deps = {}) {
    this._snsClient = deps.snsClient ?? null;
  }

  get snsClient(): SnsSender {
    if (!this._snsClient) {
      this._snsClient = new SNSClient({
        ...AWS_CLIENT_OPTIONS,
        region: aws.region,
        credentials: {
          accessKeyId: aws.accessKeyId,
          secretAccessKey: aws.secretAccessKey
        }
      });
    }
    return this._snsClient;
  }

  get PLATFORM_ARNS(): { ios: string; android: string } {
    if (!this._PLATFORM_ARNS) {
      this._PLATFORM_ARNS = {
        ios: notifications.sns.platformArnIos,
        android: notifications.sns.platformArnAndroid
      };
    }
    return this._PLATFORM_ARNS;
  }

  /**
   * Registra un dispositivo para recibir push notifications. Sigue la receta de AWS: crear el endpoint
   * (o reutilizar el que ya tiene ese token) y, si SNS lo dejó deshabilitado (EndpointDisabled) o con
   * otro token/usuario, actualizarlo y habilitarlo. CreatePlatformEndpoint solo no lo rehabilita.
   * @param {string} deviceToken - Token del dispositivo
   * @param {string} platform    - 'ios' o 'android'
   * @param {string} userId      - ID del usuario
   * @returns {Promise<string>} EndpointArn
   */
  async registrarDispositivo(deviceToken: string, platform: string, userId: string) {
    // FIX: La validación de plataforma se hace ANTES del try/catch.
    // Si estuviera dentro, el catch la atrapaba y la reenvolvía como
    // AppError.internal (500), pisando el statusCode 400 original.
    const platformArn = (this.PLATFORM_ARNS as Record<string, string | undefined>)[platform.toLowerCase()];
    if (!platformArn) {
      throw AppError.badRequest(`Plataforma no soportada: ${platform}`);
    }

    try {
      const endpointArn = await this._crearEndpoint(platformArn, deviceToken, userId);
      if (endpointArn) {
        await this._habilitarEndpoint(endpointArn, deviceToken, userId);
      }

      logger.info('Dispositivo registrado exitosamente', { userId, platform, endpointArn });

      return endpointArn;
    } catch (error) {
      logger.warn('Error al registrar dispositivo', { error: errorMessage(error), userId, platform });
      throw providerFailure(error, 'Error al registrar dispositivo para notificaciones');
    }
  }

  /** Crea el endpoint del token, o devuelve el que ya existe para ese token con otros atributos. */
  async _crearEndpoint(platformArn: string, deviceToken: string, userId: string): Promise<string | undefined> {
    const command = new CreatePlatformEndpointCommand({ PlatformApplicationArn: platformArn, Token: deviceToken, CustomUserData: userId });
    try {
      // getter (no el campo): el campo es null hasta el primer uso y registrar fallaba siempre en frío
      const response = await callProvider({ product: 'sns', endpoint: 'SNS:CreatePlatformEndpoint' }, abortSignal =>
        this.snsClient.send(command, { abortSignal })
      );
      return response.EndpointArn;
    } catch (error) {
      const existing = awsErrorCode(error) === 'InvalidParameter' ? EXISTING_ENDPOINT_RE.exec(errorMessage(error)) : null;
      if (!existing) throw error;
      return existing[1];
    }
  }

  /** Deja el endpoint habilitado, con el token y el usuario actuales (solo escribe si algo difiere). */
  async _habilitarEndpoint(endpointArn: string, deviceToken: string, userId: string): Promise<void> {
    const current = await callProvider({ product: 'sns', endpoint: 'SNS:GetEndpointAttributes' }, abortSignal =>
      this.snsClient.send(new GetEndpointAttributesCommand({ EndpointArn: endpointArn }), { abortSignal })
    );
    const attrs = current.Attributes ?? {};
    if (attrs.Enabled === 'true' && attrs.Token === deviceToken && attrs.CustomUserData === userId) return;

    await callProvider({ product: 'sns', endpoint: 'SNS:SetEndpointAttributes' }, abortSignal =>
      this.snsClient.send(
        new SetEndpointAttributesCommand({
          EndpointArn: endpointArn,
          Attributes: { Token: deviceToken, CustomUserData: userId, Enabled: 'true' }
        }),
        { abortSignal }
      )
    );
    logger.info('Endpoint SNS rehabilitado', { endpointArn, wasEnabled: attrs.Enabled === 'true', userId });
  }

  /**
   * Elimina un endpoint de SNS (desregistrar dispositivo)
   * @param {string} endpointArn - ARN del endpoint a eliminar
   */
  async eliminarDispositivo(endpointArn: string) {
    try {
      await callProvider({ product: 'sns', endpoint: 'SNS:DeleteEndpoint' }, abortSignal =>
        this.snsClient.send(new DeleteEndpointCommand({ EndpointArn: endpointArn }), { abortSignal })
      );
      logger.info('Dispositivo eliminado exitosamente', { endpointArn });
      return true;
    } catch (error) {
      logger.warn('Error al eliminar dispositivo', { error: errorMessage(error), endpointArn });
      throw providerFailure(error, 'Error al eliminar dispositivo');
    }
  }

  /**
   * Envía una notificación push a un dispositivo específico
   * @param {string} endpointArn - ARN del endpoint
   * @param {string} title       - Título de la notificación
   * @param {string} body        - Cuerpo de la notificación
   * @param {Object} data        - Datos adicionales (opcional)
   * @param {string} [notificationId] - Queda en la traza de la llamada, para buscarla por notificación
   * Si falla, lanza el error del proveedor (su `name` es el código: EndpointDisabled, …).
   */
  async enviarPushIndividual(
    endpointArn: string,
    title: string,
    body: string,
    data: Record<string, unknown> = {},
    notificationId: string | null = null
  ) {
    try {
      const message = this._construirMensajePush(title, body, data);
      const command = new PublishCommand({ TargetArn: endpointArn, Message: JSON.stringify(message), MessageStructure: 'json' });
      const response = await callProvider({ product: 'sns', endpoint: 'SNS:PublishCommand', notificationId }, abortSignal =>
        this.snsClient.send(command, { abortSignal })
      );
      logger.info('Push individual enviado exitosamente', { endpointArn, title });
      return response;
    } catch (error) {
      logger.warn('Error al enviar push individual', { error: errorMessage(error), endpointArn });
      throw error;
    }
  }

  /**
   * Envía notificaciones push masivas a múltiples dispositivos
   * @param {Array<string>} endpointArns - Array de ARNs de endpoints
   * @param {string} title              - Título
   * @param {string} body               - Cuerpo
   * @param {Object} data               - Datos adicionales (opcional)
   * @returns {Promise<{ success: number, failed: number, disabledEndpoints: string[] }>} disabledEndpoints: los
   *   que SNS reportó dados de baja (EndpointDisabled), para desactivar su token.
   */
  async enviarPushMasivo(endpointArns: string[], title: string, body: string, data: Record<string, unknown> = {}) {
    try {
      const results = await Promise.all(
        endpointArns.map(arn =>
          this.enviarPushIndividual(arn, title, body, data)
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
        total: endpointArns.length,
        title
      });
      return stats;
    } catch (error) {
      logger.warn('Error al enviar push masivo', { error: errorMessage(error) });
      return { success: 0, failed: endpointArns.length, disabledEndpoints: [] as string[] };
    }
  }

  /**
   * Construye el mensaje en formato para iOS y Android
   * @private
   */
  _construirMensajePush(title: string, body: string, data = {}) {
    return {
      default: body,
      APNS: JSON.stringify({
        aps: {
          alert: { title, body },
          sound: 'default',
          badge: 1
        },
        data
      }),
      GCM: JSON.stringify({
        notification: { title, body, sound: 'default' },
        data
      })
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace PushNotificationService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    snsClient?: SnsSender;
  }
}

export default Object.assign(new PushNotificationService(), { PushNotificationService });
