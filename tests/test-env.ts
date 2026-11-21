// tests/test-env.ts
//
// Entorno de test. Lo aplican Jest (tests/jest.setup.env.ts) y `npm run db:test:prepare`
// (scripts/db-test-prepare.ts), así los dos ven la misma base.
//
//   1. Carga `.env` si existe (desarrollo local — respeta tu config real).
//   2. Rellena SOLO como fallback (`??=`) las variables que `shared/constants/config.ts` exige al
//      arrancar, con valores dummy válidos: `npm test` corre en un clone recién clonado o en CI sin `.env`.
//   3. La base de test es Postgres (no hay perfil SQLite: Prisma fija el proveedor en el schema), en
//      un ESQUEMA PROPIO — `TEST_DB_SCHEMA`, por defecto `test` — para no tocar los datos de desarrollo
//      aunque `.env` apunte a la misma base. Solo los tests de integración se conectan; los unitarios
//      mockean los repositorios y no necesitan base.
//
// Los tests que necesitan llaves reales (jwt.util, encryption.util) generan las suyas propias.
import dotenv from 'dotenv';
import { generateKeyPairSync } from 'node:crypto';

export function applyTestEnv(): void {
  dotenv.config({ quiet: true });

  process.env.NODE_ENV = 'test';

  // ── Base de datos: Postgres, esquema aislado ──
  process.env.DB_HOST ??= 'localhost';
  process.env.DB_PORT ??= '5432';
  process.env.DB_NAME ??= 'postgres';
  process.env.DB_USER ??= 'postgres';
  process.env.DB_PASSWORD ??= 'postgres';
  // Siempre se pisa (no `??=`): el DB_SCHEMA de .env es el de desarrollo
  process.env.DB_SCHEMA = process.env.TEST_DB_SCHEMA || 'test';
  // Base local o service container de CI: sin TLS
  process.env.LOCALHOST ??= 'true';

  // ── Cifrado (longitudes exactas exigidas por config.ts) ──
  process.env.AES_KEY ??= '0'.repeat(64); // 32 bytes hex
  process.env.AES_IV ??= '0'.repeat(32); //  16 bytes hex
  process.env.HASH_PEPPER ??= 'test-pepper-0000000000000000000000000000'; // >= 32 chars

  // ── JWT RS256 (par efímero solo para test si no hay uno en el entorno) ──
  if (!process.env.JWT_PRIVATE_KEY || !process.env.JWT_PUBLIC_KEY) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    process.env.JWT_PRIVATE_KEY = privateKey;
    process.env.JWT_PUBLIC_KEY = publicKey;
  }

  // ── AWS (los tests mockean los SDK; solo deben existir para pasar la validación) ──
  process.env.AWS_REGION ??= 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID ??= 'test-access-key-id';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'test-secret-access-key';
  process.env.BUCKET_NAME ??= 'test-private-bucket';
  process.env.S3_PUBLIC_BUCKET_NAME ??= 'test-public-bucket';
  process.env.CLOUDFRONT_DISTRIBUTION_ID ??= 'TEST_DISTRIBUTION_ID';
  process.env.CLOUDFRONT_BASE_URL ??= 'https://test.cloudfront.net';

  // ── Frontend ──
  process.env.FRONTEND_RESET_URL ??= 'http://localhost:3000/reset';

  // ── Workers apagados en test (evita timers/schedulers colgando la suite) ──
  process.env.ENABLE_WORKERS ??= 'false';
}

export default { applyTestEnv };
