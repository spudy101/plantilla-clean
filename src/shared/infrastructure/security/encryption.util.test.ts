// tests/unit/shared/encryption.util.test.ts
//
// EncryptionUtil: cifrado AES-256-GCM con IV aleatorio (formato self-contained iv:authTag:ciphertext),
// descifrado con detección de formato legado (AES-256-CBC), HMAC de requests mobile y utilidades hash.
// Mockeamos shared/constants para no arrancar la validación real de .env (que haría process.exit),
// entregando una llave/IV deterministas.

import crypto from 'node:crypto';

// 32 bytes (64 hex) para AES-256, 16 bytes (32 hex) para el IV legado.
const AES_KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const AES_IV_HEX = '000102030405060708090a0b0c0d0e0f';

jest.mock('../config', () => ({
  encryption: {
    aesKey: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    aesIv: '000102030405060708090a0b0c0d0e0f',
    algorithm: 'aes-256-gcm'
  }
}));

import EncryptionUtil from './encryption.util';

describe('EncryptionUtil', () => {
  describe('encrypt / decrypt (AES-256-GCM, formato nuevo)', () => {
    it('roundtrip: descifrar lo cifrado devuelve el texto original', () => {
      const original = 'dato-sensible-12345';
      const cifrado = EncryptionUtil.encrypt(original);
      expect(EncryptionUtil.decrypt(cifrado)).toBe(original);
    });

    it('produce el formato ivHex:authTagHex:ciphertextHex (3 partes, IV de 12 bytes)', () => {
      const cifrado = EncryptionUtil.encrypt('hola');
      const partes = cifrado.split(':');
      expect(partes).toHaveLength(3);
      expect(partes[0]).toMatch(/^[a-f0-9]{24}$/); // IV = 12 bytes = 24 hex
      expect(partes[1]).toMatch(/^[a-f0-9]{32}$/); // authTag = 16 bytes = 32 hex
      expect(partes[2]).toMatch(/^[a-f0-9]+$/);
    });

    it('usa IV aleatorio: cifrar el mismo valor dos veces da salidas distintas', () => {
      const a = EncryptionUtil.encrypt('mismo-valor');
      const b = EncryptionUtil.encrypt('mismo-valor');
      expect(a).not.toBe(b);
      // Pero ambos descifran al mismo texto.
      expect(EncryptionUtil.decrypt(a)).toBe('mismo-valor');
      expect(EncryptionUtil.decrypt(b)).toBe('mismo-valor');
    });

    it('preserva null y undefined sin cifrar', () => {
      expect(EncryptionUtil.encrypt(null)).toBeNull();
      expect(EncryptionUtil.encrypt(undefined)).toBeUndefined();
    });

    it('decrypt preserva valores falsy (null/undefined/"")', () => {
      expect(EncryptionUtil.decrypt(null)).toBeNull();
      expect(EncryptionUtil.decrypt(undefined)).toBeUndefined();
      expect(EncryptionUtil.decrypt('')).toBe('');
    });

    it('rechaza (lanza) al descifrar un ciphertext GCM manipulado (authTag no valida)', () => {
      const cifrado = EncryptionUtil.encrypt('integridad');
      const [iv, authTag, ct] = cifrado.split(':') as [string, string, string];
      // Alteramos el último byte del ciphertext.
      const ctMutado = ct.slice(0, -2) + (ct.slice(-2) === '00' ? 'ff' : '00');
      const manipulado = `${iv}:${authTag}:${ctMutado}`;
      expect(() => EncryptionUtil.decrypt(manipulado)).toThrow();
    });

    it('rechaza (lanza) si el authTag fue alterado', () => {
      const cifrado = EncryptionUtil.encrypt('integridad');
      const [iv, authTag, ct] = cifrado.split(':') as [string, string, string];
      const tagMutado = authTag.slice(0, -2) + (authTag.slice(-2) === '00' ? 'ff' : '00');
      expect(() => EncryptionUtil.decrypt(`${iv}:${tagMutado}:${ct}`)).toThrow();
    });
  });

  describe('decrypt (formato legado AES-256-CBC)', () => {
    it('descifra un ciphertext CBC con IV fijo (una sola parte, sin ":")', () => {
      // Simulamos un dato legado cifrado con AES-256-CBC + IV fijo del .env.
      const cipher = crypto.createCipheriv(
        'aes-256-cbc',
        Buffer.from(AES_KEY_HEX, 'hex'),
        Buffer.from(AES_IV_HEX, 'hex')
      );
      const legadoHex = cipher.update('valor-legado', 'utf8', 'hex') + cipher.final('hex');
      expect(legadoHex).not.toContain(':'); // rama legada (parts.length !== 3)
      expect(EncryptionUtil.decrypt(legadoHex)).toBe('valor-legado');
    });
  });

  describe('safeDecrypt', () => {
    it('descifra un valor cifrado correctamente', () => {
      const cifrado = EncryptionUtil.encrypt('secreto');
      expect(EncryptionUtil.safeDecrypt(cifrado)).toBe('secreto');
    });

    it('retorna el valor original si no se puede descifrar (no lanza)', () => {
      expect(EncryptionUtil.safeDecrypt('valor-en-claro-no-cifrado')).toBe('valor-en-claro-no-cifrado');
    });

    it('preserva valores falsy', () => {
      expect(EncryptionUtil.safeDecrypt(null)).toBeNull();
      expect(EncryptionUtil.safeDecrypt('')).toBe('');
    });
  });

  describe('generateRequestHmac / verifyRequestHmac', () => {
    const secret = 'secreto-del-dispositivo';

    it('firma sobre timestamp:METHOD:path y coincide con el HMAC manual', () => {
      const firma = EncryptionUtil.generateRequestHmac('1736000000000', 'POST', '/api/v1/tx', secret);
      const esperado = crypto
        .createHmac('sha256', secret)
        .update('1736000000000:POST:/api/v1/tx')
        .digest('hex');
      expect(firma).toBe(esperado);
      expect(firma).toMatch(/^[a-f0-9]{64}$/);
    });

    it('normaliza el método a mayúsculas', () => {
      const min = EncryptionUtil.generateRequestHmac('1', 'post', '/x', secret);
      const may = EncryptionUtil.generateRequestHmac('1', 'POST', '/x', secret);
      expect(min).toBe(may);
    });

    it('verifyRequestHmac acepta firma correcta (roundtrip)', () => {
      const firma = EncryptionUtil.generateRequestHmac('1', 'GET', '/ping', secret);
      const esperada = EncryptionUtil.generateRequestHmac('1', 'GET', '/ping', secret);
      expect(EncryptionUtil.verifyRequestHmac(firma, esperada)).toBe(true);
    });

    it('verifyRequestHmac rechaza una firma alterada', () => {
      const esperada = EncryptionUtil.generateRequestHmac('1', 'GET', '/ping', secret);
      const distinta = EncryptionUtil.generateRequestHmac('1', 'GET', '/otra', secret);
      expect(EncryptionUtil.verifyRequestHmac(distinta, esperada)).toBe(false);
    });

    it('verifyRequestHmac rechaza firmas de distinta longitud o falsy sin lanzar', () => {
      const esperada = EncryptionUtil.generateRequestHmac('1', 'GET', '/ping', secret);
      expect(EncryptionUtil.verifyRequestHmac('abcd', esperada)).toBe(false);
      expect(EncryptionUtil.verifyRequestHmac('', esperada)).toBe(false);
      expect(EncryptionUtil.verifyRequestHmac(esperada, null)).toBe(false);
    });
  });

  describe('generateHash', () => {
    it('SHA-256 determinístico (64 hex) por defecto', () => {
      const h = EncryptionUtil.generateHash('referencia');
      expect(h).toMatch(/^[a-f0-9]{64}$/);
      expect(EncryptionUtil.generateHash('referencia')).toBe(h);
      expect(h).toBe(crypto.createHash('sha256').update('referencia').digest('hex'));
    });

    it('respeta el algoritmo indicado', () => {
      expect(EncryptionUtil.generateHash('x', 'sha512')).toMatch(/^[a-f0-9]{128}$/);
    });
  });

  describe('generateHmac', () => {
    it('HMAC determinístico coincidente con el cálculo manual', () => {
      const h = EncryptionUtil.generateHmac('data', 'clave');
      expect(h).toBe(crypto.createHmac('sha256', 'clave').update('data').digest('hex'));
    });

    it('cambia con el secreto', () => {
      expect(EncryptionUtil.generateHmac('data', 'k1')).not.toBe(EncryptionUtil.generateHmac('data', 'k2'));
    });
  });

  describe('generateRandomString', () => {
    it('longitud por defecto: 32 bytes => 64 hex', () => {
      expect(EncryptionUtil.generateRandomString()).toMatch(/^[a-f0-9]{64}$/);
    });

    it('respeta la longitud pedida (N bytes => 2N hex)', () => {
      expect(EncryptionUtil.generateRandomString(8)).toMatch(/^[a-f0-9]{16}$/);
    });

    it('genera valores distintos en llamadas sucesivas', () => {
      expect(EncryptionUtil.generateRandomString()).not.toBe(EncryptionUtil.generateRandomString());
    });
  });
});
