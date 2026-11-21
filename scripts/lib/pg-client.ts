// scripts/lib/pg-client.ts
//
// Conexión `pg` de los scripts de base (db:migrate, db:reset, compare-schemas). Solo necesita las
// variables DB_* (igual que el CLI de Prisma): no carga shared/constants ni exige el resto del entorno
// de la app. Mismo criterio de TLS que shared/database/prisma.ts: sin TLS en localhost (LOCALHOST=true),
// con el bundle CA de RDS si RDS_CA_BUNDLE_PATH está configurado.
import 'dotenv/config';
import fs from 'node:fs';
import { Client } from 'pg';

export function dbSchema(): string {
  return process.env.DB_SCHEMA || 'public';
}

export async function connectPg(): Promise<Client> {
  const localhost = process.env.LOCALHOST?.trim() === 'true';
  const ca = process.env.RDS_CA_BUNDLE_PATH;
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: localhost
      ? undefined
      : ca
        ? { rejectUnauthorized: true, ca: fs.readFileSync(ca, 'utf8') }
        : { rejectUnauthorized: false },
    // misma sesión en UTC que la app (shared/database/prisma.ts): now() en las migraciones da instantes UTC
    options: '-c TimeZone=UTC'
  });
  await client.connect();
  return client;
}

/** `"esquema"."tabla"` existe en la base. */
export async function tableExists(client: Client, schema: string, table: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>('SELECT to_regclass($1) IS NOT NULL AS "exists"', [
    `"${schema}"."${table}"`
  ]);
  return rows[0]?.exists === true;
}
