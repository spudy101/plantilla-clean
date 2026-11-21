// tests/unit/shared/sanitize-text.util.test.ts
//
// Sanitización de texto plano (C-8, prevención XSS server-side sin dependencias).
// Funciones puras: no tocan red, BD ni logger. Verificamos el comportamiento real
// de stripHtmlTags, decodeHtmlEntities y sanitizePlainText (doble pasada + truncado).

import sanitizeTextUtilModule from './sanitize-text.util';
const { sanitizePlainText, stripHtmlTags, decodeHtmlEntities } = sanitizeTextUtilModule;

describe('sanitize-text.util', () => {
  describe('stripHtmlTags', () => {
    it('elimina cualquier etiqueta HTML y conserva el texto visible', () => {
      expect(stripHtmlTags('<b>hola</b> <i>mundo</i>')).toBe('hola mundo');
      expect(stripHtmlTags('<script>alert(1)</script>ok')).toBe('alert(1)ok');
    });

    it('deja intacto un texto sin etiquetas', () => {
      expect(stripHtmlTags('texto plano')).toBe('texto plano');
    });

    it('devuelve el valor tal cual si no es string', () => {
      expect(stripHtmlTags(123)).toBe(123);
      expect(stripHtmlTags(null)).toBeNull();
      expect(stripHtmlTags(undefined)).toBeUndefined();
    });
  });

  describe('decodeHtmlEntities', () => {
    it('decodifica las entidades HTML peligrosas conocidas', () => {
      expect(decodeHtmlEntities('&lt;script&gt;')).toBe('<script>');
      expect(decodeHtmlEntities('a &amp; b')).toBe('a & b');
      expect(decodeHtmlEntities('&quot;x&quot;')).toBe('"x"');
      expect(decodeHtmlEntities('&#x27;y&#x2F;z&#x60;&#x3D;')).toBe("'y/z`=");
    });

    it('no altera texto sin entidades', () => {
      expect(decodeHtmlEntities('sin entidades')).toBe('sin entidades');
    });

    it('devuelve el valor tal cual si no es string', () => {
      expect(decodeHtmlEntities(42)).toBe(42);
      expect(decodeHtmlEntities(null)).toBeNull();
    });
  });

  describe('sanitizePlainText', () => {
    it('retorna null para null o undefined', () => {
      expect(sanitizePlainText(null)).toBeNull();
      expect(sanitizePlainText(undefined)).toBeNull();
    });

    it('convierte valores no-string a string y trunca al máximo', () => {
      expect(sanitizePlainText(1234567890, 3)).toBe('123');
      expect(sanitizePlainText(42)).toBe('42');
    });

    it('elimina etiquetas HTML y recorta espacios', () => {
      expect(sanitizePlainText('  <p>hola</p>  ')).toBe('hola');
    });

    it('detecta entidades escapadas gracias a la doble pasada (decode + strip)', () => {
      // &lt;script&gt;...&lt;/script&gt; → decode a <script>...</script> → strip → contenido interno.
      expect(sanitizePlainText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('alert(1)');
    });

    it('trunca al maxLength por defecto (2000)', () => {
      const largo = 'a'.repeat(2500);
      expect(sanitizePlainText(largo)).toHaveLength(2000);
    });

    it('respeta un maxLength personalizado', () => {
      expect(sanitizePlainText('abcdefghij', 4)).toBe('abcd');
    });

    it('preserva texto plano legible sin cambios', () => {
      expect(sanitizePlainText('Motivo de rechazo: documento ilegible')).toBe('Motivo de rechazo: documento ilegible');
    });

    it('retorna cadena vacía cuando todo el contenido eran etiquetas', () => {
      expect(sanitizePlainText('<div><span></span></div>')).toBe('');
    });
  });
});
