// tests/unit/shared/business-hours.util.test.ts
//
// business-hours.util: horas hábiles colombianas (Ley Emiliani). Lógica pura sobre Date
// (recibe la fecha por argumento, no lee la hora del sistema), así que no hacen falta fake
// timers. Usamos fechas locales explícitas con new Date(año, mesIdx, día, ...) para que
// getDay()/getFullYear() (que operan en hora local) sean deterministas.

import businessHoursUtilModule from './business-hours.util';
const { isBusinessDay, addBusinessHours } = businessHoursUtilModule;

describe('business-hours.util', () => {
  describe('isBusinessDay', () => {
    it('un lunes normal no festivo es día hábil', () => {
      // 2026-01-05 es lunes (1 ene 2026 = jueves).
      expect(isBusinessDay(new Date(2026, 0, 5))).toBe(true);
    });

    it('un martes normal no festivo es día hábil', () => {
      expect(isBusinessDay(new Date(2026, 0, 6))).toBe(true);
    });

    it('el sábado NO es día hábil', () => {
      // 2026-01-10 es sábado.
      expect(isBusinessDay(new Date(2026, 0, 10))).toBe(false);
    });

    it('el domingo NO es día hábil', () => {
      // 2026-01-11 es domingo.
      expect(isBusinessDay(new Date(2026, 0, 11))).toBe(false);
    });

    it('un festivo FIJO en día de semana NO es día hábil (Año Nuevo 2026, jueves)', () => {
      expect(isBusinessDay(new Date(2026, 0, 1))).toBe(false);
    });

    it('un festivo FIJO de mitad de año NO es día hábil (20 jul, Independencia 2026)', () => {
      expect(isBusinessDay(new Date(2026, 6, 20))).toBe(false);
    });

    it('un festivo FLOTANTE NO es día hábil (Reyes Magos 2026 → lunes 12 ene)', () => {
      expect(isBusinessDay(new Date(2026, 0, 12))).toBe(false);
    });

    it('respeta la tabla de otro año (Navidad 2025, jueves)', () => {
      expect(isBusinessDay(new Date(2025, 11, 25))).toBe(false);
    });
  });

  describe('addBusinessHours', () => {
    it('suma horas dentro del mismo día hábil', () => {
      // Lunes 2026-01-05 09:00 + 5 horas hábiles = mismo día 14:00.
      const start = new Date(2026, 0, 5, 9, 0, 0);
      const due = addBusinessHours(start, 5);
      expect(due).toEqual(new Date(2026, 0, 5, 14, 0, 0));
    });

    it('cuenta 24 horas hábiles como un día hábil completo', () => {
      // Lunes 00:00 + 24 h hábiles = martes 00:00 (todas las horas del lunes cuentan).
      const start = new Date(2026, 0, 5, 0, 0, 0);
      const due = addBusinessHours(start, 24);
      expect(due).toEqual(new Date(2026, 0, 6, 0, 0, 0));
    });

    it('salta fin de semana Y festivo contiguo (viernes noche → martes)', () => {
      // Viernes 2026-01-09 23:00 + 1 h hábil. La siguiente hora cae en sábado (no hábil),
      // se salta sáb/dom y también el lunes 12 (Reyes, festivo) → primera hora hábil = martes 13 00:00.
      const start = new Date(2026, 0, 9, 23, 0, 0);
      const due = addBusinessHours(start, 1);
      expect(due).toEqual(new Date(2026, 0, 13, 0, 0, 0));
    });

    it('con 0 horas devuelve una copia de la fecha de inicio sin mutarla', () => {
      const start = new Date(2026, 0, 5, 9, 0, 0);
      const due = addBusinessHours(start, 0);
      expect(due).toEqual(start);
      expect(due).not.toBe(start); // es una copia, no la misma referencia
    });

    it('trata horas negativas como 0 (no retrocede)', () => {
      const start = new Date(2026, 0, 5, 9, 0, 0);
      const due = addBusinessHours(start, -10);
      expect(due).toEqual(start);
    });

    it('redondea horas fraccionarias antes de contar', () => {
      // 2.4 → round → 2 horas.
      const start = new Date(2026, 0, 5, 9, 0, 0);
      const due = addBusinessHours(start, 2.4);
      expect(due).toEqual(new Date(2026, 0, 5, 11, 0, 0));
    });

    it('no muta la fecha de inicio recibida', () => {
      const start = new Date(2026, 0, 5, 9, 0, 0);
      const snapshot = start.getTime();
      addBusinessHours(start, 5);
      expect(start.getTime()).toBe(snapshot);
    });
  });
});
