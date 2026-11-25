// Cookies de sesión del cliente web (access + refresh). Una sola definición para login, refresh, logout y registro.
// La vida del access token llega de la composición del módulo (la fija la configuración de JWT).
import type { CookieOptions, Response } from 'express';

const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  path: '/'
};

const REFRESH_TOKEN_TTL_HOURS = 24;
const REFRESH_TOKEN_TTL_SECONDS = REFRESH_TOKEN_TTL_HOURS * 60 * 60; // exp del refresh y TTL del JTI
const MS_PER_SECOND = 1000;

export interface AuthCookies {
  set(res: Response, tokens: { accessToken: string; refreshToken: string }): void;
  clear(res: Response): void;
}

/** `accessTokenTtlSeconds`: el exp del access token RS256 (15 min). */
export function createAuthCookies(accessTokenTtlSeconds: number): AuthCookies {
  return {
    set(res, tokens) {
      res.cookie('access_token', tokens.accessToken, { ...COOKIE_OPTIONS, maxAge: accessTokenTtlSeconds * MS_PER_SECOND });
      res.cookie('refresh_token', tokens.refreshToken, { ...COOKIE_OPTIONS, maxAge: REFRESH_TOKEN_TTL_SECONDS * MS_PER_SECOND });
    },
    clear(res) {
      res.clearCookie('access_token', COOKIE_OPTIONS);
      res.clearCookie('refresh_token', COOKIE_OPTIONS);
    }
  };
}
