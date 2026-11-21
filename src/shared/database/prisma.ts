// shared/database/prisma.ts
//
// Cliente único de Prisma para toda la app. Usa el driver adapter de Postgres (`@prisma/adapter-pg`,
// requerido en Prisma 7) con las variables DB_*, el esquema DB_SCHEMA y TLS salvo en localhost (con el
// bundle CA de RDS si está configurado).
//
// Solo lo importan los repositorios y shared/database: los services dependen de los repositorios.
// Crear el cliente no abre conexiones: el pool de pg conecta en la primera consulta.
// Los avisos y errores de Prisma van al logger de la app; las consultas, solo con DB_LOGGING=true.
// Sobre el cliente base se aplica piiExtension (shared/database/prisma-extensions.ts): cifrado de PII
// y origen de sesión, lo que en Sequelize hacían los hooks de los modelos.
import fs from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { piiExtension } from './prisma-extensions';
import constantsModule from '../constants';
const { database, server } = constantsModule;
import loggerUtilModule from '../observability/logger.util';
const { logger } = loggerUtilModule;

function sslConfig() {
  if (server.localhost === 'true') {
    return undefined;
  }
  return database.rdsCaBundlePath
    ? { rejectUnauthorized: true, ca: fs.readFileSync(database.rdsCaBundlePath, 'utf8') }
    : { rejectUnauthorized: false };
}

// Cuánto espera una consulta por una conexión libre del pool. Sin esto `pg` espera para siempre (0): con
// el pool agotado o la base caída la petición quedaba colgada. Al vencer, el error se responde 503
// DATABASE_UNAVAILABLE (shared/database/database-errors.ts) y el cliente reintenta.
const POOL_CONNECTION_TIMEOUT_MS = 5_000;

// Sesión siempre en UTC. El adapter escribe las fechas como hora UTC sin offset y al leer reemplaza el
// offset por +00:00: si la sesión tomaba la zona del servidor (p. ej. America/Santiago en una base local)
// cada instante quedaba guardado corrido 3-4 h y `now()` en SQL no coincidía con las fechas de la app.
// Guardamos instantes UTC; el cliente los muestra en la zona de su dispositivo.
const SESSION_OPTIONS = '-c TimeZone=UTC';

const adapter = new PrismaPg(
  {
    host: database.host,
    port: database.port,
    database: database.name,
    user: database.user,
    password: database.password,
    ssl: sslConfig(),
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
    options: SESSION_OPTIONS
  },
  { schema: database.schema || 'public' }
);

const baseClient = new PrismaClient({
  adapter,
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' }
  ]
});

if (database.logging) {
  baseClient.$on('query', e => logger.debug('prisma:query', { query: e.query, params: e.params, durationMs: e.duration }));
}
baseClient.$on('warn', e => logger.warn('prisma:warn', { message: e.message, target: e.target }));
baseClient.$on('error', e => logger.error('prisma:error', { message: e.message, target: e.target }));

const prisma = baseClient.$extends(piiExtension);

export default prisma;
