// scripts/db-test-prepare.ts — `npm run db:test:prepare`
//
// Deja lista la base de los tests de integración: el MISMO entorno que ve Jest (tests/test-env.ts:
// Postgres, esquema aislado TEST_DB_SCHEMA — por defecto `test` —, sin TLS) y sobre él un db:reset sin
// seeders (dropea y recrea solo ese esquema y aplica las migraciones). Los datos de desarrollo no se
// tocan aunque `.env` apunte a la misma base: db:reset se niega a correr sobre `public`.
//
// Se corre una vez (y de nuevo cuando cambian las migraciones); en CI, antes de `npm test`.
import { execSync } from 'node:child_process';
import { applyTestEnv } from '../tests/test-env';

applyTestEnv();
console.log(`[db:test:prepare] Base ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}, esquema "${process.env.DB_SCHEMA}"`);
execSync('npx tsx scripts/db-reset.ts --skip-seed', { stdio: 'inherit', env: process.env });
