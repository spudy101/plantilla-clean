// prisma/seeds/seed-client.ts
//
// Lo común de los seeds: el tipo del cliente (el cliente único de la app, con la extensión de PII, así
// los seeds escriben PII en claro y la base la guarda cifrada como cualquier repositorio) y la salida.
//
// Regla de todos los seeds: crean lo que falta, buscando por su clave natural (code, name, version…), y
// no modifican ni borran lo que ya existe. `npm run db:seed` se puede correr las veces que haga falta
// sin pisar lo que se editó desde el admin. Para cambiar un dato ya sembrado en bases existentes se
// escribe una migración (prisma/migrations), no se edita el seed. Única excepción: los templates de
// los tipos de notificación, que la API no edita y el seed mantiene al día (notifications.seed.ts).
import type prisma from '../../src/shared/infrastructure/database/prisma';

export type SeedClient = typeof prisma;

/** Salida del seed en la consola (es un CLI: no pasa por el logger de la app). */
export function report(message: string): void {
  process.stdout.write(`[db:seed] ${message}\n`);
}

/** "N creados" / "ya existían" para los seeds de catálogos. */
export function reportCreated(what: string, created: number, total: number): void {
  report(created > 0 ? `${what}: ${created} de ${total} creados` : `${what}: ya existían (${total})`);
}
