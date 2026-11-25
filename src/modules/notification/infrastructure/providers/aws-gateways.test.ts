// Los adaptadores de AWS: registro de dispositivos y push masivo (SNS, con el cliente reemplazado) y el armado del
// email con adjuntos (SES).
jest.mock('../../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
  logAudit: jest.fn()
}));

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-sns', () => {
  const actual = jest.requireActual('@aws-sdk/client-sns');
  return { ...actual, SNSClient: jest.fn().mockImplementation(() => ({ send: mockSend })) };
});

import constantsModule from '../../../../shared/infrastructure/config';
import { SnsPushGateway, buildPushPayload } from './sns-push.gateway';
import { buildMimeWithAttachments, resolveAttachments } from './ses-email.gateway';
import { UnsupportedPushPlatformError } from '../../domain/errors';

beforeEach(() => jest.clearAllMocks());

describe('SnsPushGateway', () => {
  beforeAll(() => {
    Object.assign(constantsModule.notifications.sns, { platformArnIos: 'arn:ios', platformArnAndroid: 'arn:android' });
  });

  // Antes se usaba el cliente antes de crearlo: en un proceso recién levantado registrar fallaba siempre con 500.
  it('registra un dispositivo en frío, sin cliente inyectado ni usado antes', async () => {
    mockSend.mockResolvedValue({ EndpointArn: 'arn:aws:sns:endpoint/1' });
    await expect(new SnsPushGateway().registerDevice('fcm-token', 'Android', 'u-1')).resolves.toBe('arn:aws:sns:endpoint/1');
    // crear + leer atributos (+ habilitar, porque el doble no devuelve atributos)
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('una plataforma sin configurar es un error del cliente', async () => {
    await expect(new SnsPushGateway().registerDevice('t', 'windows', 'u-1')).rejects.toThrow(UnsupportedPushPlatformError);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('masivo: cuenta los enviados y devuelve los dados de baja', async () => {
    // Por destino (callProvider reintenta los fallos temporales: cada destino responde siempre igual)
    mockSend.mockImplementation(async (command: { input: { TargetArn?: string } }) => {
      if (command.input.TargetArn === 'b') {
        throw Object.assign(new Error('disabled'), { name: 'EndpointDisabled' });
      }
      if (command.input.TargetArn === 'c') {
        throw new Error('boom');
      }
      return {};
    });
    await expect(new SnsPushGateway().sendToMany(['a', 'b', 'c'], { title: 'T', body: 'B', data: {} })).resolves.toEqual({
      success: 1,
      failed: 2,
      disabledEndpoints: ['b']
    });
  });

  it('el mensaje lleva el formato de iOS y de Android', () => {
    const payload = buildPushPayload('T', 'B', { x: 1 });
    expect(payload.default).toBe('B');
    expect(JSON.parse(payload.APNS)).toEqual({ aps: { alert: { title: 'T', body: 'B' }, sound: 'default', badge: 1 }, data: { x: 1 } });
    expect(JSON.parse(payload.GCM)).toEqual({ notification: { title: 'T', body: 'B', sound: 'default' }, data: { x: 1 } });
  });
});

describe('email con adjuntos (SES)', () => {
  it('normaliza los adjuntos de la metadata y descarta los inválidos', () => {
    expect(
      resolveAttachments([
        { filename: 'a.pdf', contentType: 'application/pdf', content: 'QUJD' },
        { filename: 'b.bin', content: Buffer.from('hola') },
        { filename: 'sin-contenido.txt' },
        { content: 'QUJD' }
      ])
    ).toEqual([
      { filename: 'a.pdf', contentType: 'application/pdf', base64: 'QUJD' },
      { filename: 'b.bin', contentType: 'application/octet-stream', base64: Buffer.from('hola').toString('base64') }
    ]);
    expect(resolveAttachments(undefined)).toEqual([]);
  });

  it('arma el MIME multipart con el asunto en UTF-8 y cada adjunto en base64', () => {
    const mime = buildMimeWithAttachments('ana@correo.co', 'Señal', '<p>Hola</p>', [{ filename: 'a.pdf', contentType: 'application/pdf', base64: 'QUJD' }]);
    expect(mime).toContain('To: ana@correo.co');
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from('Señal').toString('base64')}?=`);
    expect(mime).toContain('Content-Disposition: attachment; filename="a.pdf"\r\n\r\nQUJD');
    expect(mime.trimEnd()).toMatch(/--BaseProjectMIME\d+--$/);
  });
});
