// shared/types/express.d.ts
//
// Propiedades que los middlewares del proyecto agregan a `req`. Al ampliar el tipo Request de
// Express (declaration merging) el resto del código las ve tipadas sin casts.

/** Usuario autenticado (lo arma AuthMiddleware a partir del access token RS256). */
export interface AuthenticatedUser {
  sessionId: string | null;
  userId: string;
  personId: string | null;
  roleId: string | null;
  roleName: string | null;
  firstName: string | null;
  lastName: string | null;
  nationalId: string | null;
  username: string | null;
  authUsername: string | null;
  email: string | null;
  tokenIat: number | undefined;
  tokenExp: number | undefined;
  /** Canal por el que se autenticó: cookie (web) o Bearer (mobile). */
  canal: 'web' | 'mobile';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Id de correlación de la petición (correlation middleware). */
      correlationId?: string;
      /** Usuario autenticado; solo existe después de AuthMiddleware.authenticate. */
      user?: AuthenticatedUser;
      /** Portal que atiende la petición en modo monolito ('admin' | 'client'). */
      serverContext?: 'admin' | 'client';
      /** Integración externa autenticada por API key o webhook. */
      externalService?: string;
      /** Clave del lock anti-doble-envío (request-lock middleware). */
      lockKey?: string;
    }
  }
}
