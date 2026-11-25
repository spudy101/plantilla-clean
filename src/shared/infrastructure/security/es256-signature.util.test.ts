// Verificación ES256 REAL con node:crypto (sin mocks): DER, raw r||s, PEM y casos inválidos.

jest.mock('../observability/logger.util', () => ({ logger: { info: jest.fn() } }));

import { Loose } from 'tests/helpers/mock';
import crypto from 'node:crypto';
import es256SignatureUtilModule from './es256-signature.util';
const { verifyEs256Signature, rawToDer, derToPem } = es256SignatureUtilModule;

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pubDerBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const challenge = crypto.randomBytes(32).toString('base64url');

const sign = (dsaEncoding: Loose) =>
  crypto.sign('sha256', Buffer.from(challenge, 'base64url'), { key: privateKey, dsaEncoding }).toString('base64url');

describe('es256-signature.util', () => {
  it('verifica una firma DER con la llave pública en base64 (SPKI/DER)', () => {
    expect(verifyEs256Signature({ publicKey: pubDerBase64, challenge, signature: sign('der') })).toBe(true);
  });

  it('verifica una firma raw (r||s, 64 bytes) convirtiéndola a DER', () => {
    expect(verifyEs256Signature({ publicKey: pubDerBase64, challenge, signature: sign('ieee-p1363') })).toBe(true);
  });

  it('acepta la llave pública ya en PEM', () => {
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(verifyEs256Signature({ publicKey: pem, challenge, signature: sign('der') })).toBe(true);
  });

  it('devuelve false si la firma no corresponde al challenge', () => {
    const other = crypto.randomBytes(32).toString('base64url');
    expect(verifyEs256Signature({ publicKey: pubDerBase64, challenge: other, signature: sign('der') })).toBe(false);
  });

  it('devuelve false (sin lanzar) ante datos corruptos', () => {
    expect(verifyEs256Signature({ publicKey: 'no-es-una-llave', challenge, signature: 'xxxx' })).toBe(false);
  });

  it('derToPem envuelve en líneas de 64 caracteres y rawToDer produce una SEQUENCE ASN.1', () => {
    const pem = derToPem(pubDerBase64);
    expect(pem.startsWith('-----BEGIN PUBLIC KEY-----\n')).toBe(true);
    expect(pem.split('\n').slice(1, -1).every(line => line.length <= 64)).toBe(true);

    const der = rawToDer(Buffer.from(sign('ieee-p1363'), 'base64url'));
    expect(der[0]).toBe(0x30);
  });
});
