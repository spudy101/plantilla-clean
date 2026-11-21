// tests/unit/shared/hmac.service.test.ts
//
// HmacService: validación HMAC de requests mobile (anti-replay) sobre EncryptionUtil + repo de
// dispositivos de confianza. Usamos EncryptionUtil REAL para firmar/verificar (roundtrip auténtico),
// mockeamos shared/constants (para no arrancar validación de .env), el logger y el repository (sin BD).

jest.mock('../../../shared/infrastructure/config', () => ({
  encryption: {
    aesKey: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    aesIv: '000102030405060708090a0b0c0d0e0f',
    algorithm: 'aes-256-gcm'
  }
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

// El service hace lazy require del repo de dispositivos de confianza; lo mockeamos por su ruta.
jest.mock('../repositories/auth-trusted-device.repository', () => ({
  findAnyByFingerprint: jest.fn()
}));

import { mocked, fixture } from 'tests/helpers/mock';
import HmacService from './hmac.service';
import EncryptionUtil from '../../../shared/infrastructure/security/encryption.util';
import trustedDeviceRepoModule from '../repositories/auth-trusted-device.repository';
const trustedDeviceRepo = mocked(trustedDeviceRepoModule);

const DEVICE_SECRET = 'secreto-hmac-del-dispositivo';
const FINGERPRINT = 'fingerprint-hash-123';

/**
 * Construye un req mobile válido con firma HMAC real calculada sobre timestamp:METHOD:path.
 */
function buildSignedReq({ method = 'POST', path = '/api/v1/tx', timestamp = Date.now(), secret = DEVICE_SECRET } = {}) {
  const ts = String(timestamp);
  const signature = EncryptionUtil.generateRequestHmac(ts, method, path, secret);
  // Record con claves opcionales: cada test borra el header que quiere ver faltar
  const headers: Record<string, string | undefined> = {
    'x-timestamp': ts,
    'x-signature': signature,
    'x-device-id': FINGERPRINT,
    'user-agent': 'jest'
  };
  return { method, path, ip: '1.2.3.4', headers };
}

describe('HmacService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    trustedDeviceRepo.findAnyByFingerprint.mockResolvedValue({ hmacSecret: DEVICE_SECRET });
  });

  describe('verifyRequestSignature — camino feliz', () => {
    it('acepta una firma válida dentro de la ventana de tiempo', async () => {
      const req = buildSignedReq();
      await expect(HmacService.verifyRequestSignature(fixture(req))).resolves.toBeUndefined();
      expect(trustedDeviceRepo.findAnyByFingerprint).toHaveBeenCalledWith(FINGERPRINT);
    });
  });

  describe('verifyRequestSignature — headers faltantes', () => {
    it('rechaza si falta x-timestamp', async () => {
      const req = buildSignedReq();
      delete req.headers['x-timestamp'];
      await expect(HmacService.verifyRequestSignature(fixture(req))).rejects.toMatchObject({ statusCode: 401 });
    });

    it('rechaza si falta x-signature', async () => {
      const req = buildSignedReq();
      delete req.headers['x-signature'];
      await expect(HmacService.verifyRequestSignature(fixture(req))).rejects.toMatchObject({ statusCode: 401 });
    });

    it('rechaza si falta x-device-id', async () => {
      const req = buildSignedReq();
      delete req.headers['x-device-id'];
      await expect(HmacService.verifyRequestSignature(fixture(req))).rejects.toMatchObject({ statusCode: 401 });
    });
  });

  describe('verifyRequestSignature — ventana de tiempo', () => {
    it('rechaza un timestamp no numérico', async () => {
      const req = buildSignedReq();
      req.headers['x-timestamp'] = 'no-es-numero';
      await expect(HmacService.verifyRequestSignature(fixture(req))).rejects.toMatchObject({ statusCode: 401 });
    });

    it('rechaza un timestamp fuera de la tolerancia (> 10s)', async () => {
      // El timestamp firmado queda 60s en el pasado -> fuera de ventana antes de verificar la firma.
      const req = buildSignedReq({ timestamp: Date.now() - 60_000 });
      await expect(HmacService.verifyRequestSignature(fixture(req))).rejects.toMatchObject({ statusCode: 401 });
      // No llega a consultar el dispositivo: se corta en la validación de tiempo.
      expect(trustedDeviceRepo.findAnyByFingerprint).not.toHaveBeenCalled();
    });
  });

  describe('verifyRequestSignature — dispositivo', () => {
    it('rechaza si el dispositivo no existe', async () => {
      trustedDeviceRepo.findAnyByFingerprint.mockResolvedValue(null);
      await expect(HmacService.verifyRequestSignature(fixture(buildSignedReq()))).rejects.toMatchObject({ statusCode: 401 });
    });

    it('rechaza si el dispositivo no tiene hmacSecret', async () => {
      trustedDeviceRepo.findAnyByFingerprint.mockResolvedValue({ hmacSecret: null });
      await expect(HmacService.verifyRequestSignature(fixture(buildSignedReq()))).rejects.toMatchObject({ statusCode: 401 });
    });
  });

  describe('verifyRequestSignature — firma', () => {
    it('rechaza si la firma no corresponde al secret del dispositivo', async () => {
      // Firmamos con un secret distinto al que devuelve el repo.
      const req = buildSignedReq({ secret: 'otro-secreto-distinto' });
      await expect(HmacService.verifyRequestSignature(fixture(req))).rejects.toMatchObject({ statusCode: 401 });
    });

    it('rechaza si el path firmado no coincide con el del request', async () => {
      const req = buildSignedReq({ path: '/api/v1/tx' });
      req.path = '/api/v1/otra'; // el request llega a otra ruta -> el expected difiere
      await expect(HmacService.verifyRequestSignature(fixture(req))).rejects.toMatchObject({ statusCode: 401 });
    });
  });

  describe('generateDeviceSecret', () => {
    it('genera 64 chars hex (32 bytes de entropía)', () => {
      expect(HmacService.generateDeviceSecret()).toMatch(/^[a-f0-9]{64}$/);
    });

    it('genera secretos distintos en llamadas sucesivas', () => {
      expect(HmacService.generateDeviceSecret()).not.toBe(HmacService.generateDeviceSecret());
    });
  });
});
