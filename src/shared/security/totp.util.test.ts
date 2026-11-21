// tests/unit/shared/totp.util.test.ts
//
// TotpUtil (RFC 6238 sobre otplib). Cripto pura: no toca BD ni cifrado en reposo.
// Cargamos el módulo con isolateModules para poder alternar el flag MOCKS.EXTERNAL_PROVIDERS
// (que en modo mock acepta el código fijo 123456, paridad con el OTP de SMS).

import { interopDefault } from '../utils/interop.util';
import { authenticator } from 'otplib';

/**
 * Carga TotpUtil con las constantes mockeadas. `mockExternal` controla si el modo
 * mock de proveedores externos está activo.
 */
type TotpUtil = typeof import('./totp.util').default;

function loadTotp(mockExternal: boolean): TotpUtil {
  let Totp!: TotpUtil;
  jest.isolateModules(() => {
    jest.doMock('../constants', () => ({
      SECURITY: { TOTP_ISSUER: 'TestIssuer' },
      MOCKS: { EXTERNAL_PROVIDERS: mockExternal }
    }));
    Totp = interopDefault(require('./totp.util') as typeof import('./totp.util'));
  });
  return Totp;
}

describe('TotpUtil', () => {
  describe('generateSecret', () => {
    it('genera un secreto base32 no vacío', () => {
      const Totp = loadTotp(false);
      const secret = Totp.generateSecret();
      expect(typeof secret).toBe('string');
      expect(secret.length).toBeGreaterThanOrEqual(16);
      // base32 (RFC 4648): solo A-Z y 2-7.
      expect(secret).toMatch(/^[A-Z2-7]+$/);
    });

    it('genera secretos distintos en llamadas sucesivas', () => {
      const Totp = loadTotp(false);
      expect(Totp.generateSecret()).not.toBe(Totp.generateSecret());
    });
  });

  describe('keyuri', () => {
    it('construye una URL otpauth con issuer, cuenta y secreto', () => {
      const Totp = loadTotp(false);
      const uri = Totp.keyuri('juan@example.com', 'JBSWY3DPEHPK3PXP');
      expect(uri).toContain('otpauth://totp/');
      expect(uri).toContain('TestIssuer');
      expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
      expect(uri).toContain('juan%40example.com');
    });
  });

  describe('verify (crypto real, sin modo mock)', () => {
    it('acepta el código vigente derivado del secreto', () => {
      const Totp = loadTotp(false);
      const secret = Totp.generateSecret();
      const code = authenticator.generate(secret);
      expect(Totp.verify(code, secret)).toBe(true);
    });

    it('rechaza un código que no corresponde al secreto', () => {
      const Totp = loadTotp(false);
      const secret = Totp.generateSecret();
      const valid = authenticator.generate(secret);
      // Un código distinto al vigente (evita la colisión astronómicamente improbable).
      const wrong = valid === '000000' ? '111111' : '000000';
      expect(Totp.verify(wrong, secret)).toBe(false);
    });

    it('rechaza token o secreto vacíos', () => {
      const Totp = loadTotp(false);
      const secret = Totp.generateSecret();
      expect(Totp.verify('', secret)).toBe(false);
      expect(Totp.verify('123456', '')).toBe(false);
      expect(Totp.verify(null, secret)).toBe(false);
    });

    it('no lanza ante un secreto malformado; retorna false', () => {
      const Totp = loadTotp(false);
      expect(() => Totp.verify('123456', 'no-es-base32!!')).not.toThrow();
      expect(Totp.verify('123456', 'no-es-base32!!')).toBe(false);
    });
  });

  describe('verify (modo mock de proveedores externos)', () => {
    it('acepta el código fijo 123456 con cualquier secreto', () => {
      const Totp = loadTotp(true);
      expect(Totp.verify('123456', 'JBSWY3DPEHPK3PXP')).toBe(true);
      // El corto-circuito del mock ocurre antes de validar el secreto.
      expect(Totp.verify('123456', '')).toBe(true);
    });

    it('para otros códigos cae al chequeo criptográfico real', () => {
      const Totp = loadTotp(true);
      const secret = Totp.generateSecret();
      expect(Totp.verify('999999', secret)).toBe(false);
      expect(Totp.verify(authenticator.generate(secret), secret)).toBe(true);
    });
  });
});
