import crypto from 'crypto';
import axios from 'axios';
import loggerUtilModule from '../observability/logger.util';
const { logger } = loggerUtilModule;
import errorMessageModule from '../utils/error-message.util';

const { errorMessage } = errorMessageModule;

/** Mensaje HTTP que SNS envía al endpoint suscrito (campos usados en la verificación). */
interface SnsMessage {
  Type: string;
  Message?: string;
  MessageId?: string;
  Subject?: string;
  Timestamp?: string;
  TopicArn?: string;
  Token?: string;
  SubscribeURL?: string;
  SigningCertURL?: string;
  Signature?: string;
  SignatureVersion?: string;
  [key: string]: unknown;
}

// Verificación de firma de mensajes de AWS SNS (webhook de bounces de SES). SNS firma cada mensaje;
// un POST forjado a nuestro webhook podría suprimir el correo de una víctima, así que la firma es
// obligatoria. Implementa el algoritmo canónico de SNS (SignatureVersion 1=SHA1, 2=SHA256) verificando
// contra el certificado de firma de AWS, con caché y guard anti-SSRF del host.

// Solo se acepta traer el cert / confirmar suscripción desde hosts SNS legítimos de AWS.
const AWS_SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

const CERT_FETCH_TIMEOUT_MS = 5000;

// Campos que entran al string canónico, por tipo de mensaje (orden EXACTO exigido por SNS).
const SIGNABLE_KEYS: Record<string, string[]> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
};

const _certCache = new Map<string, string>();

function _isAllowedAwsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && AWS_SNS_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

// String a firmar: por cada clave presente, "clave\nvalor\n" (Subject solo si viene).
function _buildStringToSign(message: SnsMessage): string | null {
  const keys = SIGNABLE_KEYS[message.Type];
  if (!keys) {
    return null;
  }
  let str = '';
  for (const key of keys) {
    if (key === 'Subject' && message.Subject === undefined) {
      continue;
    }
    if (message[key] === undefined) {
      return null; // falta un campo firmado → mensaje inválido
    }
    str += `${key}\n${message[key]}\n`;
  }
  return str;
}

async function _fetchCert(url: string): Promise<string> {
  const cached = _certCache.get(url);
  if (cached !== undefined) {
    return cached;
  }
  const { data } = await axios.get<string>(url, { timeout: CERT_FETCH_TIMEOUT_MS, responseType: 'text' });
  _certCache.set(url, data);
  return data;
}

/**
 * Verifica la firma de un mensaje SNS ya parseado (objeto). Devuelve true/false.
 * @param {Object} message - Cuerpo del mensaje SNS.
 */
async function verifySnsSignature(message: SnsMessage | null | undefined): Promise<boolean> {
  try {
    if (!message || !message.SigningCertURL || !message.Signature) {
      return false;
    }
    if (!_isAllowedAwsUrl(message.SigningCertURL)) {
      logger.warn('SNS: SigningCertURL no es de un host AWS válido', { url: message.SigningCertURL });
      return false;
    }
    const stringToSign = _buildStringToSign(message);
    if (stringToSign === null) {
      return false;
    }
    const algorithm = message.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
    const certPem = await _fetchCert(message.SigningCertURL);

    const verifier = crypto.createVerify(algorithm);
    verifier.update(stringToSign, 'utf8');
    return verifier.verify(certPem, message.Signature, 'base64');
  } catch (error) {
    logger.warn('SNS: error verificando firma', { error: errorMessage(error) });
    return false;
  }
}

/**
 * Confirma una suscripción SNS haciendo GET al SubscribeURL (solo hosts AWS válidos).
 * @param {Object} message - Mensaje SubscriptionConfirmation.
 */
async function confirmSnsSubscription(message: SnsMessage): Promise<void> {
  if (!message.SubscribeURL || !_isAllowedAwsUrl(message.SubscribeURL)) {
    throw new Error('SubscribeURL inválido o no es de un host AWS');
  }
  await axios.get(message.SubscribeURL, { timeout: CERT_FETCH_TIMEOUT_MS });
  logger.info('SNS: suscripción confirmada', { topicArn: message.TopicArn });
}

const SnsSignature = { verifySnsSignature, confirmSnsSubscription };

// eslint-disable-next-line @typescript-eslint/no-namespace, @typescript-eslint/no-redeclare
declare namespace SnsSignature {
  /** Envelope de SNS (notificación o confirmación de suscripción). */
  type Message = SnsMessage;
}

export default SnsSignature;
