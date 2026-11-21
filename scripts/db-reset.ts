// scripts/db-reset.ts — `npm run db:reset`
//
// Reset de BD acotado al esquema del template (DB_SCHEMA): dropea y recrea el ESQUEMA completo y
// vuelve a aplicar migraciones (`npm run db:migrate` → `prisma migrate deploy`) + seed
// (`npm run db:seed` → `prisma db seed`). El historial (`_prisma_migrations`) vive dentro del esquema,
// así que dropearlo también lo resetea. No usa `prisma migrate reset` para conservar la guarda de abajo
// y aplicar exactamente lo mismo que un despliegue.
//
// GUARDA DE SEGURIDAD: esta instancia Postgres puede compartirse entre varios esquemas (p. ej. el
// template en `plantilla` y un proyecto real en otro). Por eso se niega a correr si DB_SCHEMA está
// vacío o es `public`, para no arrastrar tablas de esquemas vecinos.
//
// `--skip-seed`: solo migraciones (lo usa `npm run db:test:prepare`: los tests no necesitan catálogos).
import { execSync } from 'node:child_process';
import { connectPg } from './lib/pg-client';

const SCHEMA = process.env.DB_SCHEMA;
const SKIP_SEED = process.argv.includes('--skip-seed');

async function main(): Promise<void> {
  if (!SCHEMA || SCHEMA === 'public') {
    console.error(`[db:reset] DB_SCHEMA inseguro o vacío ("${SCHEMA}"). Abortado para no tocar esquemas compartidos.`);
    process.exit(1);
  }

  console.log(`[db:reset] Reseteando esquema "${SCHEMA}"...`);
  const client = await connectPg();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await client.query(`CREATE SCHEMA "${SCHEMA}"`);
  } finally {
    await client.end();
  }

  console.log('[db:reset] Esquema recreado. Aplicando migraciones...');
  execSync('npm run db:migrate --silent', { stdio: 'inherit', env: process.env });

  if (SKIP_SEED) {
    console.log('[db:reset] OK — esquema reconstruido y migraciones aplicadas (sin seed).');
    return;
  }

  console.log('[db:reset] Aplicando seed...');
  execSync('npm run db:seed --silent', { stdio: 'inherit', env: process.env });

  console.log('[db:reset] OK — esquema reconstruido, migraciones y seed aplicados.');
}

main().catch((err: unknown) => {
  console.error('[db:reset] ERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
