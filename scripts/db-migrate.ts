// scripts/db-migrate.ts — `npm run db:migrate`
//
// Aplica las migraciones de Prisma (`prisma migrate deploy`) sobre el esquema DB_SCHEMA. Lo corre el
// entrypoint del contenedor en cada despliegue y `db:reset` en local.
//
// Baseline de bases creadas con Sequelize (fase 6 de docs/prisma-migration.md): la migración base
// `0_init` reproduce exactamente lo que dejaban las 45 migraciones de Sequelize, así que en una base que
// ya las tiene NO se ejecuta; se registra como aplicada. Si el esquema tiene `SequelizeMeta`:
//   1. Exige que estén registradas las 45 migraciones de Sequelize (si falta alguna, la base está
//      detrás: hay que desplegar antes la última versión con Sequelize, que las aplica).
//   2. Renombra el único índice cuyo nombre dependía del esquema
//      (`<esquema>_user_sessions_user_id_status` → `idx_user_sessions_user_id_status`).
//   3. `prisma migrate resolve --applied 0_init`.
//   4. Borra `SequelizeMeta` y `SequelizeData`: el historial queda en `_prisma_migrations`.
// Cada paso es idempotente: si algo falla a mitad, volver a correr el comando lo completa.
// Después, `prisma migrate deploy` aplica las migraciones posteriores a `0_init`.
//
// Para comprobar a mano que una base existente coincide con 0_init antes de desplegar:
//   npx tsx scripts/prisma-migration/compare-schemas.ts <esquema_existente> <esquema_con_0_init>
import { execSync } from 'node:child_process';
import type { Client } from 'pg';
import { connectPg, dbSchema, tableExists } from './lib/pg-client';

const BASELINE = '0_init';

/** Las migraciones de Sequelize que reproduce 0_init (las borró la fase 6). */
const SEQUELIZE_MIGRATIONS = [
  '20250107000099-create-schema',
  '20250108000001-create-countries',
  '20250108000002-create-phone-prefixes',
  '20250108000003-create-departments',
  '20250108000004-create-cities',
  '20250108000005-create-genders',
  '20250108000006-create-roles',
  '20250108000007-create-avatar-themes',
  '20250108000008-create-avatars',
  '20250108000009-create-document-types',
  '20250108000010-create-persons',
  '20250108000011-create-person-contacts',
  '20250108000012-create-person-locations',
  '20250108000014-create-users',
  '20250108000015-create-verification-codes',
  '20250108000016-create-user-login-attempts',
  '20250113000001-create-notification-types',
  '20250113000002-create-user-notification-preference',
  '20250113000003-create-notifications',
  '20250113000004-create-global-notifications',
  '20250113000005-create-global-notification-reads',
  '20250113000006-create-user-push-tokens',
  '20250115000001-create-reset-credentials',
  '20250115000002-create-user-change-logs',
  '20250119000002-create-user-trusted-devices',
  '20250119000003-create-biometric-tables',
  '20250204000001-create-system-global-config',
  '20260327000001-create-audit-logs',
  '20260418000002-create-privacy-policies',
  '20260520000004-create-user-sessions',
  '20260522000003-create-person-references',
  '20260526000003-create-role-permission-overrides',
  '20260530000002-create-audit-alerts',
  '20260601000010-create-consent-types',
  '20260601000011-create-user-consents',
  '20260615000001-create-approval-requests',
  '20260729000001-create-integration-api-logs',
  '20260729000002-create-provider-fallback-events',
  '20260729000003-create-sms-delivery-attempts',
  '20260729000004-create-email-bounce-suppressions',
  '20260730000001-totp-native-mfa',
  '20260731000001-create-notification-categories',
  '20260731000002-add-category-to-notification-types',
  '20260731000003-add-sms-to-notifications',
  '20260731000004-refactor-user-notification-preferences-to-category'
];

const log = (msg: string) => console.log(`[db:migrate] ${msg}`);

function prisma(args: string): void {
  execSync(`npx prisma ${args}`, { stdio: 'inherit', env: process.env });
}

async function baselineRecorded(client: Client, schema: string): Promise<boolean> {
  if (!(await tableExists(client, schema, '_prisma_migrations'))) {
    return false;
  }
  const { rows } = await client.query(
    `SELECT 1 FROM "${schema}"."_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    [BASELINE]
  );
  return rows.length > 0;
}

async function baselineFromSequelize(client: Client, schema: string): Promise<void> {
  if (!(await tableExists(client, schema, 'SequelizeMeta'))) {
    return;
  }
  log(`Esquema "${schema}" creado con Sequelize: se toma como base ${BASELINE}.`);

  if (!(await baselineRecorded(client, schema))) {
    const { rows } = await client.query<{ name: string }>(`SELECT name FROM "${schema}"."SequelizeMeta"`);
    const applied = new Set(rows.map(r => r.name.replace(/\.(js|ts)$/, '')));
    const missing = SEQUELIZE_MIGRATIONS.filter(name => !applied.has(name));
    if (missing.length > 0) {
      throw new Error(
        `faltan ${missing.length} migraciones de Sequelize (${missing.join(', ')}). ` +
          'Despliega antes la última versión con Sequelize para aplicarlas y vuelve a correr db:migrate.'
      );
    }
    // Un proyecto derivado con migraciones propias de Sequelize: 0_init no las reproduce y la base
    // quedaría con objetos que no están en prisma/migrations. Necesita su propia migración base.
    const known = new Set(SEQUELIZE_MIGRATIONS);
    const extra = [...applied].filter(name => !known.has(name));
    if (extra.length > 0) {
      throw new Error(
        `SequelizeMeta tiene ${extra.length} migraciones que ${BASELINE} no reproduce (${extra.join(', ')}). ` +
          'Genera una migración base propia (docs/database.md, "Bases creadas con Sequelize") antes de continuar.'
      );
    }

    const { rows: prefixed } = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = $1 AND tablename = 'user_sessions'
          AND indexname LIKE '%\\_user_sessions\\_user_id\\_status' AND indexname <> 'idx_user_sessions_user_id_status'`,
      [schema]
    );
    for (const { indexname } of prefixed) {
      await client.query(`ALTER INDEX "${schema}"."${indexname}" RENAME TO "idx_user_sessions_user_id_status"`);
      log(`Índice ${indexname} → idx_user_sessions_user_id_status`);
    }

    prisma(`migrate resolve --applied ${BASELINE}`);
  }

  await client.query(`DROP TABLE IF EXISTS "${schema}"."SequelizeMeta", "${schema}"."SequelizeData"`);
  log('Historial de Sequelize reemplazado por _prisma_migrations (SequelizeMeta y SequelizeData eliminadas).');
}

async function main(): Promise<void> {
  const schema = dbSchema();
  const client = await connectPg();
  try {
    await baselineFromSequelize(client, schema);
  } finally {
    await client.end();
  }
  prisma('migrate deploy');
}

main().catch((err: unknown) => {
  console.error('[db:migrate] ERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
