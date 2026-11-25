// Verificación de firmas ES256 (ECDSA P-256 + SHA-256) para credenciales biométricas.
// Puro: sin BD ni estado. Extraído de AuthBiometricService (SOLID: S) — la criptografía
// cambia por razones distintas que el flujo de enrolamiento/login.

import crypto from 'node:crypto';
import loggerUtil from '../observability/logger.util';

const { logger } = loggerUtil as { logger: { info(message: string, meta?: object): void } };

const ES256_RAW_SIGNATURE_LEN = 64; // firma raw r||s: 32 bytes r + 32 bytes s
const ES256_COMPONENT_LEN = 32; // longitud de r y s individualmente
const DER_POSITIVE_PAD = 0x80; // bit MSB: si está activo, el entero es negativo en DER
const DER_INTEGER_TAG = 0x02; // tag ASN.1 INTEGER
const DER_SEQUENCE_TAG = 0x30; // tag ASN.1 SEQUENCE
const PEM_LINE_LENGTH = 64; // caracteres por línea en PEM

interface Es256SignatureInput {
  /** Llave pública en base64 (SubjectPublicKeyInfo / DER) o PEM */
  publicKey: string;
  /** String base64url que fue firmado */
  challenge: string;
  /** Firma en base64url (DER o raw r||s de 64 bytes) */
  signature: string;
}

/** Convierte una llave pública DER (base64) a formato PEM. */
function derToPem(base64Der: string): string {
  const regex = new RegExp(`.{1,${PEM_LINE_LENGTH}}`, 'g');
  const lines = (base64Der.match(regex) ?? []).join('\n');
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

/**
 * Convierte una firma raw (r||s, 64 bytes) a formato DER.
 * Los dispositivos móviles a veces envían la firma en formato raw.
 */
function rawToDer(rawSignature: Buffer): Buffer {
  const r = rawSignature.subarray(0, ES256_COMPONENT_LEN);
  const s = rawSignature.subarray(ES256_COMPONENT_LEN, ES256_RAW_SIGNATURE_LEN);

  const encodeInt = (buf: Buffer): Buffer => {
    // Si el bit más significativo es 1, agregar byte 0x00 para indicar positivo
    const needsPad = (buf[0] ?? 0) & DER_POSITIVE_PAD;
    const padded = needsPad ? Buffer.concat([Buffer.from([0x00]), buf]) : buf;
    return Buffer.concat([Buffer.from([DER_INTEGER_TAG, padded.length]), padded]);
  };

  const seq = Buffer.concat([encodeInt(r), encodeInt(s)]);
  return Buffer.concat([Buffer.from([DER_SEQUENCE_TAG, seq.length]), seq]);
}

/**
 * Verifica una firma ES256 del challenge con la llave pública registrada.
 * @returns false ante firma inválida o datos corruptos (nunca lanza)
 */
function verifyEs256Signature({ publicKey, challenge, signature }: Es256SignatureInput): boolean {
  try {
    const verify = crypto.createVerify('SHA256');
    verify.update(Buffer.from(challenge, 'base64url'));

    const pemKey = publicKey.startsWith('-----') ? publicKey : derToPem(publicKey);

    const signatureBuffer = Buffer.from(signature, 'base64url');
    const derSignature = signatureBuffer.length === ES256_RAW_SIGNATURE_LEN ? rawToDer(signatureBuffer) : signatureBuffer;

    return verify.verify(pemKey, derSignature);
  } catch (error) {
    logger.info('Biometric signature verification error', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

export default { verifyEs256Signature, derToPem, rawToDer };
