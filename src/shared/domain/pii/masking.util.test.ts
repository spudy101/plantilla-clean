// MaskingUtil: enmascaramiento de PII (documento, teléfono, correo, cuenta) + redactor profundo
// por key sobre JSONB propios. Cripto/lógica pura: no toca red ni BD, así que usamos el catálogo
// real de pii-fields (valores deterministas) sin mocks.

import { Loose } from 'tests/helpers/mock';
import MaskingUtil from './masking.util';
import piiFieldsModule from '../../domain/constants/pii-fields';
const { PII_MASK_TYPES } = piiFieldsModule;

// redactPayload devuelve unknown (acepta arrays y primitivos); sobre un objeto plano devuelve otro.
type Redacted = Record<string, Loose>;

describe('MaskingUtil', () => {
  describe('maskDocumentId', () => {
    it('deja visibles solo los últimos 4 caracteres', () => {
      expect(MaskingUtil.maskDocumentId('12345678')).toBe('****5678');
    });

    it('recorta espacios antes de enmascarar', () => {
      expect(MaskingUtil.maskDocumentId('  12345678  ')).toBe('****5678');
    });

    it('devuelve el valor intacto (ya recortado) si tiene 4 caracteres o menos', () => {
      expect(MaskingUtil.maskDocumentId('1234')).toBe('1234');
      expect(MaskingUtil.maskDocumentId('12')).toBe('12');
    });

    it('devuelve string vacío ante valores falsy o no-string', () => {
      expect(MaskingUtil.maskDocumentId('')).toBe('');
      expect(MaskingUtil.maskDocumentId(null)).toBe('');
      expect(MaskingUtil.maskDocumentId(undefined)).toBe('');
      expect(MaskingUtil.maskDocumentId(12345678)).toBe('');
    });
  });

  describe('maskPhone', () => {
    it('deja visibles solo los últimos 4 dígitos', () => {
      expect(MaskingUtil.maskPhone('+56912345678')).toBe('********5678');
    });

    it('devuelve el valor intacto si tiene 4 caracteres o menos', () => {
      expect(MaskingUtil.maskPhone('5678')).toBe('5678');
    });

    it('devuelve string vacío ante valores falsy o no-string', () => {
      expect(MaskingUtil.maskPhone(null)).toBe('');
      expect(MaskingUtil.maskPhone(56912345678)).toBe('');
    });
  });

  describe('maskEmail', () => {
    it('deja visible solo el último carácter del local y el dominio completo', () => {
      expect(MaskingUtil.maskEmail('juan@example.com')).toBe('***n@example.com');
    });

    it('enmascara un local de dos caracteres dejando el segundo visible', () => {
      expect(MaskingUtil.maskEmail('ab@x.com')).toBe('*b@x.com');
    });

    it('devuelve el valor intacto si el @ está en índice 1 o menos (local demasiado corto)', () => {
      expect(MaskingUtil.maskEmail('a@x.com')).toBe('a@x.com');
    });

    it('devuelve el valor intacto si no hay @', () => {
      expect(MaskingUtil.maskEmail('sinarroba')).toBe('sinarroba');
    });

    it('devuelve string vacío ante valores falsy o no-string', () => {
      expect(MaskingUtil.maskEmail('')).toBe('');
      expect(MaskingUtil.maskEmail(null)).toBe('');
    });
  });

  describe('maskAccount', () => {
    it('usa prefijo fijo de 4 asteriscos + últimos 4 (no revela la longitud)', () => {
      expect(MaskingUtil.maskAccount('1234567890')).toBe('****7890');
      expect(MaskingUtil.maskAccount('99999999999999')).toBe('****9999');
    });

    it('devuelve 4 asteriscos si el valor tiene 4 caracteres o menos', () => {
      expect(MaskingUtil.maskAccount('12')).toBe('****');
      expect(MaskingUtil.maskAccount('1234')).toBe('****');
    });

    it('acepta valores numéricos convirtiéndolos a string', () => {
      expect(MaskingUtil.maskAccount(1234567890)).toBe('****7890');
    });

    it('devuelve string vacío ante valores falsy', () => {
      expect(MaskingUtil.maskAccount('')).toBe('');
      expect(MaskingUtil.maskAccount(null)).toBe('');
      expect(MaskingUtil.maskAccount(0)).toBe('');
    });
  });

  describe('maskAuto (máscara por forma del valor)', () => {
    it('enmascara un correo detectado por su forma', () => {
      expect(MaskingUtil.maskAuto('juan@example.com')).toBe('***n@example.com');
    });

    it('enmascara un teléfono/documento detectado por su forma', () => {
      expect(MaskingUtil.maskAuto('+56912345678')).toBe('********5678');
    });

    it('NO enmascara fechas ISO aunque tengan forma de documento', () => {
      expect(MaskingUtil.maskAuto('1995-03-12')).toBe('1995-03-12');
      expect(MaskingUtil.maskAuto('2020-01-01T10:00:00Z')).toBe('2020-01-01T10:00:00Z');
    });

    it('devuelve intacto un valor sin forma de PII (p. ej. un estado)', () => {
      expect(MaskingUtil.maskAuto('activo')).toBe('activo');
    });

    it('devuelve el valor tal cual si no es string o está vacío', () => {
      expect(MaskingUtil.maskAuto(123)).toBe(123);
      expect(MaskingUtil.maskAuto('')).toBe('');
      expect(MaskingUtil.maskAuto('   ')).toBe('   ');
      expect(MaskingUtil.maskAuto(null)).toBeNull();
    });
  });

  describe('maskByType', () => {
    it('despacha al enmascarador correcto según el tipo', () => {
      expect(MaskingUtil.maskByType('12345678', PII_MASK_TYPES.DOCUMENT)).toBe('****5678');
      expect(MaskingUtil.maskByType('+56912345678', PII_MASK_TYPES.PHONE)).toBe('********5678');
      expect(MaskingUtil.maskByType('juan@example.com', PII_MASK_TYPES.EMAIL)).toBe('***n@example.com');
      expect(MaskingUtil.maskByType('1234567890', PII_MASK_TYPES.ACCOUNT)).toBe('****7890');
      expect(MaskingUtil.maskByType('juan@example.com', PII_MASK_TYPES.AUTO)).toBe('***n@example.com');
    });

    it('devuelve el valor intacto ante un tipo desconocido', () => {
      expect(MaskingUtil.maskByType('12345678', 'tipo-inexistente')).toBe('12345678');
    });
  });

  describe('redactPayload', () => {
    it('enmascara las keys del catálogo PII a nivel raíz', () => {
      const input = { email: 'juan@example.com', name: 'Juan', phone: '+56912345678' };
      const out = MaskingUtil.redactPayload(input) as Redacted;
      expect(out).toEqual({
        email: '***n@example.com',
        name: 'Juan',
        phone: '********5678'
      });
    });

    it('no muta el objeto original', () => {
      const input = { email: 'juan@example.com' };
      const out = MaskingUtil.redactPayload(input) as Redacted;
      expect(input.email).toBe('juan@example.com');
      expect(out).not.toBe(input);
    });

    it('reconoce keys sin importar la convención (snake/camel/mayúsculas)', () => {
      const input = { national_id: '12345678', NewEmail: 'ana@correo.cl' };
      const out = MaskingUtil.redactPayload(input) as Redacted;
      expect(out.national_id).toBe('****5678');
      expect(out.NewEmail).toBe('**a@correo.cl');
    });

    it('no confunde keys parecidas: enmascara email pero deja intacto isEmailVerified', () => {
      const input = { email: 'juan@example.com', isEmailVerified: true, emailVerifiedAt: '2020-01-01' };
      const out = MaskingUtil.redactPayload(input) as Redacted;
      expect(out.email).toBe('***n@example.com');
      expect(out.isEmailVerified).toBe(true);
      expect(out.emailVerifiedAt).toBe('2020-01-01');
    });

    it('recorre objetos anidados y arrays', () => {
      const input = {
        user: { email: 'juan@example.com' },
        contacts: [{ phone: '+56912345678' }, { phone: '+56987654321' }]
      };
      const out = MaskingUtil.redactPayload(input) as Redacted;
      expect(out.user.email).toBe('***n@example.com');
      expect(out.contacts[0].phone).toBe('********5678');
      expect(out.contacts[1].phone).toBe('********4321');
    });

    it('NO entra en los subárboles de PII_RAW_PAYLOAD_KEYS (respuestas crudas de terceros)', () => {
      const raw = { email: 'juan@example.com' };
      const input = { rawResponse: raw };
      const out = MaskingUtil.redactPayload(input) as Redacted;
      // El subárbol se conserva por referencia, intacto.
      expect(out.rawResponse).toBe(raw);
      expect(out.rawResponse.email).toBe('juan@example.com');
    });

    it('deja intactos valores no-string en keys PII (no rompe su tipo)', () => {
      const input = { phone: 56912345678 };
      const out = MaskingUtil.redactPayload(input) as Redacted;
      expect(out.phone).toBe(56912345678);
    });

    it('devuelve null/undefined tal cual', () => {
      expect(MaskingUtil.redactPayload(null)).toBeNull();
      expect(MaskingUtil.redactPayload(undefined)).toBeUndefined();
    });

    it('devuelve primitivos tal cual', () => {
      expect(MaskingUtil.redactPayload('texto')).toBe('texto');
      expect(MaskingUtil.redactPayload(42)).toBe(42);
    });

    it('devuelve instancias no-planas (Date) intactas sin recorrerlas', () => {
      const date = new Date('2020-01-01T00:00:00Z');
      const input = { createdAt: date };
      const out = MaskingUtil.redactPayload(input) as Redacted;
      expect(out.createdAt).toBe(date);
    });

    it('corta el recorrido más allá de la profundidad máxima devolviendo el valor', () => {
      // A profundidad > 8, redactPayload devuelve el valor sin recorrerlo: el email queda crudo.
      let deep: Record<string, unknown> = { email: 'juan@example.com' };
      for (let i = 0; i < 10; i++) {
        deep = { child: deep };
      }
      const out = MaskingUtil.redactPayload(deep) as Redacted;
      // Descendemos hasta encontrar el email y verificamos que NO fue enmascarado.
      let node: Loose = out;
      while (node && node.child) {
        node = node.child;
      }
      expect(node.email).toBe('juan@example.com');
    });
  });
});
