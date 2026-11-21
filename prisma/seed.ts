// prisma/seed.ts — `npm run db:seed` (`prisma db seed`, configurado en prisma.config.ts)
//
// Datos base del template sobre el esquema DB_SCHEMA, en orden de dependencias. Cada seed crea solo lo
// que falta y no modifica lo existente (prisma/seeds/seed-client.ts): se puede correr las veces que haga
// falta, también en un despliegue (RUN_SEEDS=true en entrypoint.sh).
//
// Usa el cliente de la app (shared/database/prisma.ts), así que necesita el mismo entorno que la app
// (.env completo: claves de cifrado incluidas, para la PII de los usuarios internos).
import prisma from '../src/shared/infrastructure/database/prisma';
import { seedCatalogs } from './seeds/catalogs.seed';
import { seedGeography } from './seeds/geography.seed';
import { seedInternalUsers } from './seeds/internal-users.seed';
import { seedNotifications } from './seeds/notifications.seed';
import { report } from './seeds/seed-client';
import { seedSettings } from './seeds/settings.seed';

async function main(): Promise<void> {
  await seedGeography(prisma);
  await seedCatalogs(prisma);
  await seedSettings(prisma);
  await seedNotifications(prisma);
  await seedInternalUsers(prisma);
  report('OK');
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`[db:seed] ERROR: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
