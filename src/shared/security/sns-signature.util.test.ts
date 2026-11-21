// tests/unit/shared/sns-signature.util.test.ts
//
// verifySnsSignature / confirmSnsSubscription: verificación de la firma canónica de AWS SNS
// (webhook de bounces de SES) con guard anti-SSRF del host y caché de certificado.
//
// Para no depender de un certificado firmado por AWS real, generamos un par RSA propio y
// firmamos el string canónico exactamente como lo arma el módulo: crypto.verify acepta la
// clave pública en PEM, así ejercitamos el algoritmo de verificación REAL (SignatureVersion
// 1=SHA1 / 2=SHA256). axios se mockea para servir esa clave pública como si fuera el cert.

jest.mock('axios', () => ({ get: jest.fn() }));

jest.mock('../observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

import { mocked, fixture } from 'tests/helpers/mock';
import crypto from 'crypto';
import axiosModule from 'axios';
const axios = mocked(axiosModule);
import loggerUtilModule from '../observability/logger.util';
const { logger } = mocked(loggerUtilModule);
import snsSignatureUtilModule from './sns-signature.util';
const { verifySnsSignature, confirmSnsSubscription } = snsSignatureUtilModule;
type SnsMessage = snsSignatureUtilModule.Message;

// Mismo orden EXACTO de claves firmables que el módulo bajo prueba.
const SIGNABLE_KEYS: Record<string, string[]> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
};

function buildStringToSign(message: SnsMessage) {
  let str = '';
  for (const key of SIGNABLE_KEYS[message.Type] ?? []) {
    if (key === 'Subject' && message.Subject === undefined) {continue;}
    if (message[key] === undefined) {continue;}
    str += `${key}\n${message[key]}\n`;
  }
  return str;
}

// Par RSA reutilizable para todo el archivo (generarlo es costoso).
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

function signMessage(message: SnsMessage, algorithm = 'RSA-SHA1') {
  const signer = crypto.createSign(algorithm);
  signer.update(buildStringToSign(message), 'utf8');
  return signer.sign(privateKey, 'base64');
}

// URL de cert única por test para no compartir la caché interna (_certCache) entre casos.
let certSeq = 0;
const nextCertUrl = () => `https://sns.us-east-1.amazonaws.com/cert-${++certSeq}.pem`;

describe('sns-signature.util', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('verifySnsSignature — validaciones previas (sin cripto)', () => {
    it('devuelve false si el mensaje es nulo', async () => {
      await expect(verifySnsSignature(null)).resolves.toBe(false);
    });

    it('devuelve false si falta SigningCertURL o Signature', async () => {
      await expect(verifySnsSignature(fixture({ Signature: 'x' }))).resolves.toBe(false);
      await expect(verifySnsSignature(fixture({ SigningCertURL: nextCertUrl() }))).resolves.toBe(false);
    });

    it('rechaza SigningCertURL de un host que no es de AWS (guard anti-SSRF)', async () => {
      const message = {
        Type: 'Notification',
        SigningCertURL: 'https://evil.example.com/cert.pem',
        Signature: 'AAAA'
      };
      await expect(verifySnsSignature(message)).resolves.toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('host AWS'), expect.any(Object));
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('rechaza SigningCertURL http:// aunque el host parezca de AWS', async () => {
      const message = {
        Type: 'Notification',
        SigningCertURL: 'http://sns.us-east-1.amazonaws.com/cert.pem',
        Signature: 'AAAA'
      };
      await expect(verifySnsSignature(message)).resolves.toBe(false);
    });

    it('devuelve false para un Type desconocido (no está en SIGNABLE_KEYS)', async () => {
      const message = {
        Type: 'TipoRaro',
        SigningCertURL: nextCertUrl(),
        Signature: 'AAAA'
      };
      await expect(verifySnsSignature(message)).resolves.toBe(false);
      // Falla al armar el string canónico → nunca descarga el cert.
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('devuelve false si falta un campo firmado obligatorio', async () => {
      // Notification sin MessageId → _buildStringToSign devuelve null.
      const message = {
        Type: 'Notification',
        Message: 'hola',
        Timestamp: '2026-01-01T00:00:00.000Z',
        TopicArn: 'arn:aws:sns:us-east-1:1:topic',
        SigningCertURL: nextCertUrl(),
        Signature: 'AAAA'
      };
      await expect(verifySnsSignature(message)).resolves.toBe(false);
      expect(axios.get).not.toHaveBeenCalled();
    });
  });

  describe('verifySnsSignature — verificación criptográfica real', () => {
    function makeNotification(overrides: Partial<SnsMessage> = {}): SnsMessage {
      return {
        Type: 'Notification',
        Message: 'Contenido del bounce',
        MessageId: 'msg-123',
        Subject: 'Asunto',
        Timestamp: '2026-01-01T00:00:00.000Z',
        TopicArn: 'arn:aws:sns:us-east-1:1:topic',
        SigningCertURL: nextCertUrl(),
        SignatureVersion: '1',
        ...overrides
      };
    }

    it('acepta una firma válida (SignatureVersion 1 = RSA-SHA1)', async () => {
      const message = makeNotification();
      message.Signature = signMessage(message, 'RSA-SHA1');
      axios.get.mockResolvedValue({ data: publicKey });

      await expect(verifySnsSignature(message)).resolves.toBe(true);
      expect(axios.get).toHaveBeenCalledWith(message.SigningCertURL, expect.any(Object));
    });

    it('acepta una firma válida con SignatureVersion 2 (RSA-SHA256)', async () => {
      const message = makeNotification({ SignatureVersion: '2' });
      message.Signature = signMessage(message, 'RSA-SHA256');
      axios.get.mockResolvedValue({ data: publicKey });

      await expect(verifySnsSignature(message)).resolves.toBe(true);
    });

    it('acepta una Notification SIN Subject (campo opcional omitido del canónico)', async () => {
      const message = makeNotification();
      delete message.Subject;
      message.Signature = signMessage(message, 'RSA-SHA1');
      axios.get.mockResolvedValue({ data: publicKey });

      await expect(verifySnsSignature(message)).resolves.toBe(true);
    });

    it('rechaza si el Message fue manipulado tras la firma', async () => {
      const message = makeNotification();
      message.Signature = signMessage(message, 'RSA-SHA1');
      message.Message = 'contenido ALTERADO';
      axios.get.mockResolvedValue({ data: publicKey });

      await expect(verifySnsSignature(message)).resolves.toBe(false);
    });

    it('rechaza si la firma se generó con SHA256 pero se declara versión 1 (SHA1)', async () => {
      const message = makeNotification({ SignatureVersion: '1' });
      message.Signature = signMessage(message, 'RSA-SHA256'); // desalineado
      axios.get.mockResolvedValue({ data: publicKey });

      await expect(verifySnsSignature(message)).resolves.toBe(false);
    });

    it('devuelve false (no lanza) si la descarga del cert falla', async () => {
      const message = makeNotification();
      message.Signature = signMessage(message, 'RSA-SHA1');
      axios.get.mockRejectedValue(new Error('timeout'));

      await expect(verifySnsSignature(message)).resolves.toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('error verificando firma'), expect.any(Object));
    });
  });

  describe('confirmSnsSubscription', () => {
    it('hace GET al SubscribeURL cuando es un host AWS válido', async () => {
      axios.get.mockResolvedValue({ data: 'ok' });
      const url = 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription';
      await confirmSnsSubscription(fixture({ SubscribeURL: url, TopicArn: 'arn:aws:sns:us-east-1:1:t' }));

      expect(axios.get).toHaveBeenCalledWith(url, expect.any(Object));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('suscripción confirmada'), expect.any(Object));
    });

    it('lanza si falta el SubscribeURL', async () => {
      await expect(confirmSnsSubscription(fixture({}))).rejects.toThrow('SubscribeURL');
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('lanza si el SubscribeURL no es de un host AWS válido', async () => {
      await expect(
        confirmSnsSubscription(fixture({ SubscribeURL: 'https://evil.example.com/confirm' }))
      ).rejects.toThrow('host AWS');
      expect(axios.get).not.toHaveBeenCalled();
    });
  });
});
