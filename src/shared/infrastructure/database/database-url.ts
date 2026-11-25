// URL de conexión de Postgres armada desde las mismas variables que usa la app (DB_HOST, DB_PORT,
// DB_NAME, DB_USER, DB_PASSWORD, DB_SCHEMA). La necesita el CLI de Prisma (prisma.config.ts): db pull,
// migrate, studio. El cliente de la app no la usa: le pasa la config a @prisma/adapter-pg
// (shared/database/prisma.ts).
//
// No depende de shared/constants a propósito: el CLI solo necesita la base y no tiene por qué
// cumplir la validación completa de variables de la app.

type Env = Record<string, string | undefined>;

/** `postgresql://user:pass@host:port/db?schema=…` (+ sslmode fuera de localhost). */
export function databaseUrl(env: Env = process.env): string {
  const missing = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'].filter(k => !env[k]);
  if (missing.length > 0) {
    throw new Error(`databaseUrl: faltan variables de entorno: ${missing.join(', ')}`);
  }
  const user = encodeURIComponent(env.DB_USER ?? '');
  const password = env.DB_PASSWORD ? `:${encodeURIComponent(env.DB_PASSWORD)}` : '';
  const params = new URLSearchParams({ schema: env.DB_SCHEMA || 'public' });
  // Mismo criterio que config/database.ts: TLS salvo en localhost (LOCALHOST=true)
  if (env.LOCALHOST !== 'true') {
    params.set('sslmode', 'require');
    if (env.RDS_CA_BUNDLE_PATH) {
      params.set('sslrootcert', env.RDS_CA_BUNDLE_PATH);
    }
  }
  return `postgresql://${user}${password}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}?${params.toString()}`;
}

export default { databaseUrl };
