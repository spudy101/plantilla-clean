// shared/utils/auth-cookies.util.ts
//
// Cookies de sesión del cliente web (access + refresh). Una sola definición para login, refresh,
// logout y registro: antes cada controller tenía su copia ("mismos valores que auth-login") y
// cualquier cambio de atributos había que replicarlo a mano.
import type { CookieOptions, Response } from 'express';
import constantsModule from '../../../shared/infrastructure/config';
const { jwt: jwtConfig } = constantsModule;

const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  path: '/'
};

// El maxAge de cada cookie sigue la vida REAL de su token. Tenerlas vivas más tiempo que el token
// que transportan hace que el navegador siga mandando credenciales muertas y que el front crea que
// hay sesión cuando ya no la hay.
const ACCESS_TOKEN_TTL_SECONDS = jwtConfig.accessTokenExpiry; // 15 min — exp del access token RS256
const REFRESH_TOKEN_TTL_HOURS = 24;
const REFRESH_TOKEN_TTL_SECONDS = REFRESH_TOKEN_TTL_HOURS * 60 * 60; // exp del refresh y TTL del JTI
const MS_PER_SECOND = 1000;

function setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }): void {
  res.cookie('access_token', tokens.accessToken, { ...COOKIE_OPTIONS, maxAge: ACCESS_TOKEN_TTL_SECONDS * MS_PER_SECOND });
  res.cookie('refresh_token', tokens.refreshToken, { ...COOKIE_OPTIONS, maxAge: REFRESH_TOKEN_TTL_SECONDS * MS_PER_SECOND });
}

// clearCookie solo borra si los atributos coinciden con los del Set-Cookie original: sin
// sameSite/secure, varios navegadores dejan la cookie viva y la sesión "cerrada" sigue mandando
// credenciales. Se repiten los mismos COOKIE_OPTIONS (sin maxAge, que no participa del match).
function clearAuthCookies(res: Response): void {
  res.clearCookie('access_token', COOKIE_OPTIONS);
  res.clearCookie('refresh_token', COOKIE_OPTIONS);
}

export default { setAuthCookies, clearAuthCookies };
