// HashUtil: HMAC-SHA256 determinístico con PEPPER para poblar columnas _hash y buscar campos
// cifrados. Cripto pura, sin BD. El PEPPER se lee de process.env.HASH_PEPPER al CARGAR el módulo,
// así que lo fijamos antes de requerirlo (y probamos la ausencia con isolateModules).

// Debe fijarse ANTES de requerir el módulo: el PEPPER se captura en una const al cargar.
process.env.HASH_PEPPER = 'pepper-de-test-determinista-con-mas-de-32-chars';

import { interopDefault } from '../../kernel/interop.util';
import { fixture } from 'tests/helpers/mock';
import crypto from 'node:crypto';
import HashUtil from './hash.util';

describe('HashUtil', () => {
  describe('hashForSearch', () => {
    it('genera un HMAC-SHA256 de 64 chars hex', () => {
      const hash = HashUtil.hashForSearch('12345678');
      expect(typeof hash).toBe('string');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('es determinístico: mismo valor produce siempre el mismo hash', () => {
      expect(HashUtil.hashForSearch('juan@example.com')).toBe(HashUtil.hashForSearch('juan@example.com'));
    });

    it('normaliza el valor (trim + lowercase) antes de hashear', () => {
      const base = HashUtil.hashForSearch('abc');
      expect(HashUtil.hashForSearch('  ABC  ')).toBe(base);
      expect(HashUtil.hashForSearch('Abc')).toBe(base);
    });

    it('valores distintos producen hashes distintos', () => {
      expect(HashUtil.hashForSearch('11111111')).not.toBe(HashUtil.hashForSearch('22222222'));
    });

    it('coincide con el HMAC calculado manualmente con el mismo PEPPER', () => {
      const esperado = crypto
        .createHmac('sha256', fixture(process.env.HASH_PEPPER))
        .update('12345678')
        .digest('hex');
      expect(HashUtil.hashForSearch('12345678')).toBe(esperado);
    });

    it('retorna null para null, undefined y string vacío', () => {
      expect(HashUtil.hashForSearch(null)).toBeNull();
      expect(HashUtil.hashForSearch(undefined)).toBeNull();
      expect(HashUtil.hashForSearch('')).toBeNull();
    });

    it('acepta valores numéricos coaccionándolos a string', () => {
      expect(HashUtil.hashForSearch(12345678)).toBe(HashUtil.hashForSearch('12345678'));
    });
  });

  describe('verify', () => {
    it('acepta un valor en claro que coincide con su hash almacenado', () => {
      const stored = HashUtil.hashForSearch('juan@example.com');
      expect(HashUtil.verify('juan@example.com', stored)).toBe(true);
    });

    it('acepta aun con diferencias de mayúsculas/espacios (misma normalización)', () => {
      const stored = HashUtil.hashForSearch('juan@example.com');
      expect(HashUtil.verify('  JUAN@EXAMPLE.COM ', stored)).toBe(true);
    });

    it('rechaza un valor en claro que no corresponde al hash', () => {
      const stored = HashUtil.hashForSearch('juan@example.com');
      expect(HashUtil.verify('pedro@example.com', stored)).toBe(false);
    });

    it('rechaza si el valor en claro o el hash son falsy', () => {
      const stored = HashUtil.hashForSearch('juan@example.com');
      expect(HashUtil.verify('', stored)).toBe(false);
      expect(HashUtil.verify('juan@example.com', '')).toBe(false);
      expect(HashUtil.verify(null, stored)).toBe(false);
    });

    it('no lanza ante un hash almacenado malformado (no hex / longitud impar); retorna false', () => {
      expect(() => HashUtil.verify('juan@example.com', 'no-es-hex!!')).not.toThrow();
      expect(HashUtil.verify('juan@example.com', 'no-es-hex!!')).toBe(false);
      // Hash con longitud distinta -> timingSafeEqual lanza y se captura -> false.
      expect(HashUtil.verify('juan@example.com', 'abcd')).toBe(false);
    });
  });

  describe('sin PEPPER configurado', () => {
    it('hashForSearch lanza un error explicativo', () => {
      jest.isolateModules(() => {
        const original = process.env.HASH_PEPPER;
        delete process.env.HASH_PEPPER;
        try {
          const FreshHashUtil: typeof import('./hash.util').default = interopDefault(require('./hash.util') as typeof import('./hash.util'));
          expect(() => FreshHashUtil.hashForSearch('algo')).toThrow(/HASH_PEPPER/);
        } finally {
          process.env.HASH_PEPPER = original;
        }
      });
    });
  });
});
