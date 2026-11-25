// DeviceFingerprintUtil: hash estable de dispositivo (SHA-256 del User-Agent normalizado,
// sin IP), nombre legible, parseo de UA (ua-parser-js real) y geolocalización (geoip-lite,
// mockeado para no depender de su base offline). Foco: determinismo y sensibilidad del hash.

jest.mock('geoip-lite', () => ({ lookup: jest.fn() }));

import { mocked, fixture } from 'tests/helpers/mock';
import geoipModule from 'geoip-lite';
const geoip = mocked(geoipModule);
import DeviceFingerprintUtil from './device-fingerprint.util';

const UA_CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.129 Safari/537.36';
const UA_IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

describe('DeviceFingerprintUtil', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('generateHash', () => {
    it('produce un SHA-256 hex de 64 caracteres', () => {
      const hash = DeviceFingerprintUtil.generateHash(UA_CHROME_WIN);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('es determinista: misma entrada → mismo hash', () => {
      expect(DeviceFingerprintUtil.generateHash(UA_CHROME_WIN)).toBe(
        DeviceFingerprintUtil.generateHash(UA_CHROME_WIN)
      );
    });

    it('es sensible: entradas distintas → hashes distintos', () => {
      expect(DeviceFingerprintUtil.generateHash(UA_CHROME_WIN)).not.toBe(
        DeviceFingerprintUtil.generateHash(UA_IPHONE_SAFARI)
      );
    });

    it('normaliza builds menores: mismo navegador con distinto build → mismo hash', () => {
      const v1 =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.6099.129 Safari/537.36';
      const v2 =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.6099.999 Safari/537.36';
      expect(DeviceFingerprintUtil.generateHash(v1)).toBe(DeviceFingerprintUtil.generateHash(v2));
    });

    it('ignora mayúsculas/minúsculas y espacios múltiples (normalización)', () => {
      const a = 'MyClient android';
      const b = '  myclient    android  ';
      expect(DeviceFingerprintUtil.generateHash(a)).toBe(DeviceFingerprintUtil.generateHash(b));
    });

    it('UA vacío o ausente colapsa al hash de "unknown"', () => {
      const crypto = require('node:crypto');
      const expected = crypto.createHash('sha256').update('unknown').digest('hex');
      expect(DeviceFingerprintUtil.generateHash('')).toBe(expected);
      expect(DeviceFingerprintUtil.generateHash(fixture(undefined))).toBe(expected);
    });
  });

  describe('generateFromRequest', () => {
    it('extrae el user-agent del header y lo hashea', () => {
      const req = { headers: { 'user-agent': UA_CHROME_WIN } };
      expect(DeviceFingerprintUtil.generateFromRequest(fixture(req))).toBe(
        DeviceFingerprintUtil.generateHash(UA_CHROME_WIN)
      );
    });

    it('sin header cae al hash de UA vacío', () => {
      expect(DeviceFingerprintUtil.generateFromRequest(fixture({ headers: {} }))).toBe(
        DeviceFingerprintUtil.generateHash('')
      );
    });
  });

  describe('generateDeviceName', () => {
    it('reconoce clientes HTTP nativos de Android', () => {
      expect(DeviceFingerprintUtil.generateDeviceName('okhttp/4.9.0')).toBe('App Android');
      expect(DeviceFingerprintUtil.generateDeviceName('Dalvik/2.1.0')).toBe('App Android (Dalvik)');
      expect(DeviceFingerprintUtil.generateDeviceName('android-async-http/1.4.9')).toBe('App Android (AsyncHttp)');
      expect(DeviceFingerprintUtil.generateDeviceName('Volley/0')).toBe('App Android (Volley)');
      expect(DeviceFingerprintUtil.generateDeviceName('axios/1.6.0')).toBe('App (axios)');
    });

    it('devuelve "Navegador en SO" para un UA de escritorio', () => {
      const name = DeviceFingerprintUtil.generateDeviceName(UA_CHROME_WIN);
      expect(name).toContain('Chrome');
      expect(name).toContain(' en ');
      expect(name).toContain('Windows');
    });

    it('devuelve "Dispositivo desconocido" para UA vacío', () => {
      expect(DeviceFingerprintUtil.generateDeviceName('')).toBe('Dispositivo desconocido');
    });
  });

  describe('parseUserAgent', () => {
    it('UA vacío → desktop con browser/os nulos', () => {
      expect(DeviceFingerprintUtil.parseUserAgent('')).toEqual({
        browser: null,
        os: null,
        deviceType: 'desktop'
      });
    });

    it('clientes HTTP móviles nativos → deviceType mobile / os Android', () => {
      expect(DeviceFingerprintUtil.parseUserAgent('okhttp/4.9.0')).toEqual({
        browser: null,
        os: 'Android',
        deviceType: 'mobile'
      });
    });

    it('UA de escritorio → deviceType desktop con browser y os poblados', () => {
      const parsed = DeviceFingerprintUtil.parseUserAgent(UA_CHROME_WIN);
      expect(parsed.browser).toContain('Chrome');
      expect(parsed.os).toContain('Windows');
      expect(parsed.deviceType).toBe('desktop');
    });

    it('UA de iPhone → deviceType mobile', () => {
      const parsed = DeviceFingerprintUtil.parseUserAgent(UA_IPHONE_SAFARI);
      expect(parsed.deviceType).toBe('mobile');
      expect(parsed.os).toContain('iOS');
    });
  });

  describe('geolocateIp', () => {
    it('IP ausente → todo null', () => {
      expect(DeviceFingerprintUtil.geolocateIp('')).toEqual({
        city: null,
        country: null,
        countryCode: null
      });
    });

    it('IPs locales/privadas → "Local" sin código de país', () => {
      for (const ip of ['127.0.0.1', '::1', '192.168.1.5', '10.0.0.3', '172.16.0.1']) {
        expect(DeviceFingerprintUtil.geolocateIp(ip)).toEqual({
          city: 'Local',
          country: 'Local',
          countryCode: null
        });
      }
      expect(geoip.lookup).not.toHaveBeenCalled();
    });

    it('IP pública con geo → traduce el código ISO a nombre en español', () => {
      geoip.lookup.mockReturnValue({ city: 'Santiago', country: 'CL' });
      expect(DeviceFingerprintUtil.geolocateIp('200.1.2.3')).toEqual({
        city: 'Santiago',
        country: 'Chile',
        countryCode: 'CL'
      });
    });

    it('país sin mapeo conocido → devuelve el código tal cual', () => {
      geoip.lookup.mockReturnValue({ city: 'Reykjavik', country: 'IS' });
      expect(DeviceFingerprintUtil.geolocateIp('200.9.9.9')).toEqual({
        city: 'Reykjavik',
        country: 'IS',
        countryCode: 'IS'
      });
    });

    it('IP pública sin resultado en geoip → todo null', () => {
      geoip.lookup.mockReturnValue(null);
      expect(DeviceFingerprintUtil.geolocateIp('8.8.8.8')).toEqual({
        city: null,
        country: null,
        countryCode: null
      });
    });
  });

  describe('enrichDevice', () => {
    it('combina parseo de UA + geo + nombre legible en un solo objeto', () => {
      geoip.lookup.mockReturnValue({ city: 'Santiago', country: 'CL' });
      const enriched = DeviceFingerprintUtil.enrichDevice(UA_CHROME_WIN, '200.1.2.3');
      expect(enriched).toMatchObject({
        os: expect.stringContaining('Windows'),
        deviceType: 'desktop',
        city: 'Santiago',
        country: 'Chile',
        countryCode: 'CL'
      });
      expect(enriched.browser).toContain('Chrome');
      expect(enriched.deviceName).toContain(' en ');
    });
  });
});
