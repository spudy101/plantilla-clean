// Entrada del historial de fallbacks: defaults de paginación y tipos de los filtros.
import { FallbackQuery } from './integration-monitoring.request';

describe('FallbackQuery', () => {
  it('activeOnly acepta "1" como verdadero y las fechas salen como Date', () => {
    expect(FallbackQuery.parse({ provider: ' sns ', activeOnly: '1', from: '2026-11-01' })).toMatchObject({
      provider: 'sns',
      activeOnly: true,
      from: new Date('2026-11-01'),
      sortBy: 'startedAt',
      order: 'DESC',
      page: 1
    });
  });

  it('sin filtros: activeOnly no es verdadero', () => {
    expect(FallbackQuery.parse({}).activeOnly).not.toBe(true);
  });
});
