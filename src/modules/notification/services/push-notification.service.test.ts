// tests/unit/modules/schemas/notification/services/push-notification.service.test.ts
//
// PushNotificationService — canal de push (iOS/Android) vía AWS SNS Platform Endpoints. Probamos las
// ramas de valor sin tocar AWS: (1) registrarDispositivo → validación de plataforma (400 antes del
// try/catch), camino feliz, rehabilitación del endpoint (y reutilizar el de otro usuario), fallo (500) y circuito abierto (503); (2) eliminarDispositivo → OK y fallo
// (500); (3) enviarPushIndividual → éxito vs fallo (devuelve null, NO lanza); (4) enviarPushMasivo →
// agregación de estadísticas y endpoints dados de baja (EndpointDisabled). `callProvider` (breaker, reintentos, timeout y log) se mockea.

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: class {},
  CreatePlatformEndpointCommand: class {},
  DeleteEndpointCommand: class {},
  GetEndpointAttributesCommand: class {},
  SetEndpointAttributesCommand: class {
    constructor(readonly input: unknown) {}
  },
  PublishCommand: class {}
}));

// callProvider se mockea; CircuitOpenError es un AppError 503 como el real. providerFailure (provider-errors) es el real.
jest.mock('../../../shared/infrastructure/providers/provider-call.util', () => {
  const AppError = jest.requireActual('../../../shared/presentation/http/app-error.util').default;
  class CircuitOpenError extends AppError {
    constructor(product: string, retryInMs: number) {
      super(`Servicio externo no disponible temporalmente (${product})`, 503, 'CIRCUIT_OPEN', null, true);
      this.retryAfter = Math.ceil(retryInMs / 1000);
    }
  }
  return { callProvider: jest.fn(), CircuitOpenError };
});

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() }
}));

jest.mock('../../../shared/infrastructure/config', () => ({
  aws: { region: 'us-east-1', accessKeyId: 'ak', secretAccessKey: 'sk' },
  notifications: { sns: { platformArnIos: 'arn:aws:sns:ios', platformArnAndroid: 'arn:aws:sns:android' } }
}));

import { mocked } from 'tests/helpers/mock';
import * as providerCallModule from '../../../shared/infrastructure/providers/provider-call.util';
const callProvider = mocked(providerCallModule.callProvider);
const { CircuitOpenError } = providerCallModule;
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = mocked(loggerUtilModule);
import push from './push-notification.service';

const ENDPOINT_ARN = 'arn:aws:sns:endpoint:1';

describe('PushNotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registrarDispositivo', () => {
    it('lanza badRequest (400) si la plataforma no está soportada, antes de tocar SNS', async () => {
      await expect(push.registrarDispositivo('tok', 'windows', 'u-1')).rejects.toMatchObject({
        statusCode: 400,
        code: 'BAD_REQUEST'
      });
      expect(callProvider).not.toHaveBeenCalled();
    });

    /** Responde por operación SNS; attrs = lo que devuelve GetEndpointAttributes. */
    const sns = (attrs: Record<string, string>, create: () => unknown = () => ({ EndpointArn: ENDPOINT_ARN })) =>
      callProvider.mockImplementation(async ({ endpoint }: { endpoint: string }) => {
        if (endpoint === 'SNS:CreatePlatformEndpoint') return create();
        if (endpoint === 'SNS:GetEndpointAttributes') return { Attributes: attrs };
        return {};
      });
    const setCall = () => {
      const call = callProvider.mock.calls.find(([meta]) => meta.endpoint === 'SNS:SetEndpointAttributes');
      return call && (call[1] as (s: AbortSignal) => unknown);
    };

    it('camino feliz: registra el endpoint y devuelve el EndpointArn (ya habilitado: no lo toca)', async () => {
      sns({ Enabled: 'true', Token: 'tok', CustomUserData: 'u-1' });

      const result = await push.registrarDispositivo('tok', 'iOS', 'u-1');

      expect(callProvider).toHaveBeenCalledTimes(2);
      expect(setCall()).toBeUndefined();
      expect(result).toBe(ENDPOINT_ARN);
      expect(logger.info).toHaveBeenCalledWith(
        'Dispositivo registrado exitosamente',
        expect.objectContaining({ userId: 'u-1', endpointArn: ENDPOINT_ARN })
      );
    });

    it('rehabilita un endpoint que SNS dejó deshabilitado (EndpointDisabled)', async () => {
      const send = jest.fn().mockResolvedValue({});
      push._snsClient = { send } as never;
      sns({ Enabled: 'false', Token: 'tok', CustomUserData: 'u-1' });

      await expect(push.registrarDispositivo('tok', 'android', 'u-1')).resolves.toBe(ENDPOINT_ARN);

      await setCall()!(new AbortController().signal);
      expect(send.mock.calls[0][0].input).toEqual({
        EndpointArn: ENDPOINT_ARN,
        Attributes: { Token: 'tok', CustomUserData: 'u-1', Enabled: 'true' }
      });
    });

    it('el token ya tenía endpoint de otro usuario: lo reutiliza y lo pasa al usuario actual', async () => {
      const send = jest.fn().mockResolvedValue({});
      push._snsClient = { send } as never;
      const otherArn = 'arn:aws:sns:us-east-1:1:endpoint/GCM/app/abc';
      sns({ Enabled: 'true', Token: 'tok', CustomUserData: 'u-viejo' }, () => {
        throw Object.assign(
          new Error(`Invalid parameter: Token Reason: Endpoint ${otherArn} already exists with the same Token, but different attributes.`),
          { name: 'InvalidParameter', $metadata: { httpStatusCode: 400 } }
        );
      });

      await expect(push.registrarDispositivo('tok', 'android', 'u-1')).resolves.toBe(otherArn);

      await setCall()!(new AbortController().signal);
      expect(send.mock.calls[0][0].input).toMatchObject({ EndpointArn: otherArn, Attributes: { CustomUserData: 'u-1' } });
    });

    it('error que no viene del proveedor (bug nuestro): 500 permanente y registra warning', async () => {
      callProvider.mockRejectedValue(new Error('SNS down'));

      await expect(push.registrarDispositivo('tok', 'android', 'u-1')).rejects.toMatchObject({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        retryable: false
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('el proveedor falló de forma transitoria (5xx tras los reintentos): 503 temporal, no 500', async () => {
      callProvider.mockRejectedValue(Object.assign(new Error('caído'), { name: 'InternalError', $metadata: { httpStatusCode: 500 } }));

      await expect(push.registrarDispositivo('tok', 'android', 'u-1')).rejects.toMatchObject({
        statusCode: 503,
        retryable: true
      });
    });

    it('el proveedor rechazó la petición (4xx): 500, reintentar no lo arregla', async () => {
      callProvider.mockRejectedValue(Object.assign(new Error('token inválido'), { name: 'InvalidParameter', $metadata: { httpStatusCode: 400 } }));

      await expect(push.registrarDispositivo('tok', 'android', 'u-1')).rejects.toMatchObject({ statusCode: 500, retryable: false });
    });
  });

  describe('registrarDispositivo — circuito abierto', () => {
    it('propaga el 503 del circuito en vez de convertirlo en 500', async () => {
      callProvider.mockRejectedValue(new CircuitOpenError('sns', 5000));
      await expect(push.registrarDispositivo('tok', 'ios', 'u-1')).rejects.toMatchObject({ statusCode: 503, code: 'CIRCUIT_OPEN', retryAfter: 5 });
    });
  });

  describe('eliminarDispositivo', () => {
    it('camino feliz: elimina el endpoint y devuelve true', async () => {
      callProvider.mockResolvedValue({});

      await expect(push.eliminarDispositivo(ENDPOINT_ARN)).resolves.toBe(true);
      expect(callProvider).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('Dispositivo eliminado exitosamente', { endpointArn: ENDPOINT_ARN });
    });

    it('fallo del proveedor: lanza internal (500)', async () => {
      callProvider.mockRejectedValue(new Error('boom'));

      await expect(push.eliminarDispositivo(ENDPOINT_ARN)).rejects.toMatchObject({
        statusCode: 500,
        code: 'INTERNAL_ERROR'
      });
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('enviarPushIndividual', () => {
    it('camino feliz: publica por callProvider (sns) y devuelve la respuesta', async () => {
      const response = { MessageId: 'm-1' };
      callProvider.mockResolvedValue(response);

      const result = await push.enviarPushIndividual(ENDPOINT_ARN, 'Titulo', 'Cuerpo', { k: 'v' }, 'notif-1');

      expect(callProvider).toHaveBeenCalledWith({ product: 'sns', endpoint: 'SNS:PublishCommand', notificationId: 'notif-1' }, expect.any(Function));
      expect(result).toBe(response);
      expect(logger.info).toHaveBeenCalledWith('Push individual enviado exitosamente', expect.any(Object));
    });

    it('fallo: propaga el error del proveedor (su name es el código) y registra warning', async () => {
      callProvider.mockRejectedValue(Object.assign(new Error('disabled'), { name: 'EndpointDisabled' }));

      await expect(push.enviarPushIndividual(ENDPOINT_ARN, 'Titulo', 'Cuerpo', {}, 'notif-2')).rejects.toMatchObject({ name: 'EndpointDisabled' });
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('enviarPushMasivo', () => {
    it('camino feliz: agrega estadísticas success=total, failed=0', async () => {
      callProvider.mockResolvedValue({ MessageId: 'm-x' });

      const stats = await push.enviarPushMasivo(['arn-a', 'arn-b', 'arn-c'], 'T', 'B');

      expect(stats).toEqual({ success: 3, failed: 0, disabledEndpoints: [] });
      expect(logger.info).toHaveBeenCalledWith('Push masivo completado', expect.objectContaining({ total: 3 }));
    });

    it('cuando los envíos individuales fallan, cuentan como failed', async () => {
      // Antes enviarPushIndividual devolvía null al fallar y estos fallos contaban como success.
      callProvider.mockRejectedValue(new Error('todos fallan'));

      const stats = await push.enviarPushMasivo(['arn-a', 'arn-b'], 'T', 'B');

      expect(stats).toEqual({ success: 0, failed: 2, disabledEndpoints: [] });
    });

    it('informa los endpoints que SNS dio de baja (EndpointDisabled), no los que fallaron por otra cosa', async () => {
      const disabled = Object.assign(new Error('Endpoint is disabled'), { name: 'EndpointDisabled', $metadata: {} });
      const throttled = Object.assign(new Error('Rate exceeded'), { name: 'Throttling', $metadata: {} });
      callProvider.mockResolvedValueOnce({ MessageId: 'm' }).mockRejectedValueOnce(disabled).mockRejectedValueOnce(throttled);

      const stats = await push.enviarPushMasivo(['arn-a', 'arn-b', 'arn-c'], 'T', 'B');

      expect(stats).toEqual({ success: 1, failed: 2, disabledEndpoints: ['arn-b'] });
    });
  });
});
