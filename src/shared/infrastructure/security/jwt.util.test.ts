// JwtUtil: emisión y verificación de JWT RS256 propios (access, refresh y reto MFA) sobre `jose`.
// Cripto pura: generamos un par RSA real en el test y mockeamos shared/constants para inyectar las
// claves PEM y AUTH_ERROR_CODES sin arrancar la validación de .env (que haría process.exit).
// jose se transpila con babel-jest (ver transformIgnorePatterns), por eso carga bien en test.

import crypto from 'node:crypto';
import { SignJWT } from 'jose';

// Par RSA de test (PKCS#8 privado / SPKI público, PEM). El prefijo `mock` habilita su uso
// dentro del factory de jest.mock.
const mockJwtKeys = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

jest.mock('../observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

jest.mock('../config', () => ({
  jwt: {
    privateKey: mockJwtKeys.privateKey,
    publicKey: mockJwtKeys.publicKey,
    accessTokenExpiry: 900
  },
  AUTH_ERROR_CODES: {
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    TOKEN_INVALID: 'TOKEN_INVALID',
    REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID'
  }
}));

import JwtUtil from './jwt.util';

// Usuario mínimo con asociaciones cargadas, como espera generateAccessToken.
const buildUser = () => ({
  userId: 'user-uuid-1',
  personId: 'person-uuid-1',
  roleId: 'role-uuid-1',
  nationalId: '12345678',
  authUsername: 'jperez',
  role: { name: 'ADMIN' },
  person: { firstName: 'Juan', lastName: 'Pérez', contact: { email: 'juan@example.com' } }
});

describe('JwtUtil', () => {
  describe('access token', () => {
    it('generateAccessToken emite un JWT verificable con todos los claims de sesión', async () => {
      const token = await JwtUtil.generateAccessToken(buildUser(), 'session-uuid-1');
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // header.payload.signature

      const payload = await JwtUtil.verifyAccessToken(token);
      expect(payload?.userId).toBe('user-uuid-1');
      expect(payload.sessionId).toBe('session-uuid-1');
      expect(payload.roleName).toBe('ADMIN');
      expect(payload.firstName).toBe('Juan');
      expect(payload.email).toBe('juan@example.com');
      expect(payload.nationalId).toBe('12345678');
      expect(payload.sub).toBe('user-uuid-1');
    });

    it('normaliza asociaciones ausentes a null', async () => {
      const token = await JwtUtil.generateAccessToken({ userId: 'u2' }, null);
      const payload = await JwtUtil.verifyAccessToken(token);
      expect(payload.sessionId).toBeNull();
      expect(payload.roleName).toBeNull();
      expect(payload.email).toBeNull();
      expect(payload.personId).toBeNull();
    });

    it('verifyAccessToken lanza 401 TOKEN_INVALID ante firma inválida', async () => {
      // Token firmado con OTRA clave privada -> firma no valida contra la pública configurada.
      const otra = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' }
      });
      const nowSecs = Math.floor(Date.now() / 1000);
      const intruso = await new SignJWT({ userId: 'x' })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('x')
        .setIssuedAt(nowSecs)
        .setExpirationTime(nowSecs + 900)
        .sign(crypto.createPrivateKey(otra.privateKey));

      await expect(JwtUtil.verifyAccessToken(intruso)).rejects.toMatchObject({
        kind: 'unauthorized',
        details: { code: 'TOKEN_INVALID' }
      });
    });

    it('verifyAccessToken lanza 401 TOKEN_EXPIRED ante token vencido', async () => {
      const nowSecs = Math.floor(Date.now() / 1000);
      const vencido = await new SignJWT({ userId: 'x' })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('x')
        .setIssuedAt(nowSecs - 1000)
        .setExpirationTime(nowSecs - 500)
        .sign(crypto.createPrivateKey(mockJwtKeys.privateKey));

      await expect(JwtUtil.verifyAccessToken(vencido)).rejects.toMatchObject({
        kind: 'unauthorized',
        details: { code: 'TOKEN_EXPIRED' }
      });
    });

    it('verifyAccessToken rechaza un token basura', async () => {
      await expect(JwtUtil.verifyAccessToken('no-es-un-jwt')).rejects.toMatchObject({ kind: 'unauthorized' });
    });
  });

  describe('refresh token', () => {
    it('generateRefreshToken emite un token type=refresh con jti y sub verificable', async () => {
      const token = await JwtUtil.generateRefreshToken('user-uuid-1', 'jti-uuid-1', 'session-uuid-1');
      const payload = await JwtUtil.verifyRefreshToken(token);
      expect(payload.type).toBe('refresh');
      expect(payload?.userId).toBe('user-uuid-1');
      expect(payload.jti).toBe('jti-uuid-1');
      expect(payload.sessionId).toBe('session-uuid-1');
      expect(payload.sub).toBe('user-uuid-1');
    });

    it('verifyRefreshToken rechaza un token que no es de tipo refresh (ej: access)', async () => {
      const access = await JwtUtil.generateAccessToken(buildUser(), 'session-uuid-1');
      await expect(JwtUtil.verifyRefreshToken(access)).rejects.toMatchObject({
        kind: 'unauthorized',
        code: 'UNAUTHORIZED',
        message: 'Refresh token inválido',
        details: { code: 'REFRESH_TOKEN_INVALID' }
      });
    });

    it('verifyRefreshToken rechaza firma inválida con REFRESH_TOKEN_INVALID', async () => {
      await expect(JwtUtil.verifyRefreshToken('basura.no.valida')).rejects.toMatchObject({
        kind: 'unauthorized',
        details: { code: 'REFRESH_TOKEN_INVALID' }
      });
    });
  });

  describe('decodeUnverified', () => {
    it('decodifica el payload SIN verificar la firma', async () => {
      const token = await JwtUtil.generateAccessToken(buildUser(), 'session-uuid-1');
      const payload = JwtUtil.decodeUnverified(token);
      expect(payload?.userId).toBe('user-uuid-1');
    });

    it('retorna null ante entradas no decodificables o no-string', () => {
      expect(JwtUtil.decodeUnverified('no-es-jwt')).toBeNull();
      expect(JwtUtil.decodeUnverified('')).toBeNull();
      expect(JwtUtil.decodeUnverified(null)).toBeNull();
      expect(JwtUtil.decodeUnverified(123)).toBeNull();
    });
  });

  describe('reto MFA', () => {
    it('roundtrip: verifyMfaChallengeToken retorna el userId del token emitido', async () => {
      const token = await JwtUtil.generateMfaChallengeToken('user-uuid-1');
      const payload = await JwtUtil.verifyMfaChallengeToken(token);
      expect(payload?.userId).toBe('user-uuid-1');
      expect(payload.type).toBe('mfa_challenge');
    });

    it('verifyMfaChallengeToken rechaza un token de otro tipo (ej: access)', async () => {
      const access = await JwtUtil.generateAccessToken(buildUser(), 'session-uuid-1');
      await expect(JwtUtil.verifyMfaChallengeToken(access)).rejects.toMatchObject({ kind: 'unauthorized' });
    });

    it('verifyMfaChallengeToken rechaza un token basura', async () => {
      await expect(JwtUtil.verifyMfaChallengeToken('xxx')).rejects.toMatchObject({ kind: 'unauthorized' });
    });
  });
});
