// shared/database/database-health.ts
//
// Chequeo de la base para el arranque y /health, y cierre del pool en el shutdown. No lanza hacia
// arriba un detalle de conexión: el llamador decide qué exponer.
import prisma from './prisma';

/** Lanza si no se puede consultar la base. */
export async function checkDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

/** Cierra el pool (shutdown ordenado). */
export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export default { checkDatabase, closeDatabase };
