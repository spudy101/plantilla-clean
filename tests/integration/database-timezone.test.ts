// Contra Postgres real: la sesión de la app está en UTC, sea cual sea la zona del servidor. El adapter de
// Prisma escribe las fechas como hora UTC sin offset y al leer reemplaza el offset por +00:00; con la
// sesión en otra zona (p. ej. America/Santiago) cada instante quedaba guardado corrido 3-4 h y `now()`
// en SQL no coincidía con las fechas que manda la app.

import prisma from '../../src/shared/infrastructure/database/prisma';

afterAll(() => prisma.$disconnect());

describe('zona horaria de la sesión', () => {
  it('es UTC', async () => {
    const [row] = await prisma.$queryRawUnsafe<{ tz: string }[]>(`SELECT current_setting('TimeZone') AS tz`);
    expect(row?.tz).toBe('UTC');
  });

  it('una fecha de la app se guarda como el mismo instante y now() de la base coincide con el reloj de la app', async () => {
    const appNow = new Date();
    const [row] = await prisma.$queryRawUnsafe<{ stored: string; db_now: Date }[]>(
      `SELECT to_char($1::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS stored, now() AS db_now`,
      appNow
    );

    if (!row) {
      throw new Error('la consulta no devolvió filas');
    }
    expect(row.stored).toBe(appNow.toISOString());
    expect(Math.abs(row.db_now.getTime() - appNow.getTime())).toBeLessThan(60_000);
  });
});
