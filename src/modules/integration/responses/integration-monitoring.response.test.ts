// La salida de cada constructor de integration cumple su esquema (y por lo tanto su documentación).
import dto, { FallbackEventSchema, ProvidersHealthSchema } from './integration-monitoring.response';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const at = new Date('2026-01-01T00:00:00Z');
const fallback = {
  providerFallbackEventId: ID,
  provider: 'aws_ses',
  circuitProduct: 'ses',
  startedAt: at,
  endedAt: null,
  affectedProcessesCount: 3
};

const ok = (schema: { safeParse(v: unknown): { error?: { issues: unknown[] } } }, value: unknown) =>
  expect(schema.safeParse(value).error?.issues ?? []).toEqual([]);

describe('esquemas de salida de integration', () => {
  it('salud de proveedores: el estado del circuito se traduce a disponibilidad', () => {
    const health = dto.ProvidersHealthDTO({
      circuits: [
        { product: 'ses', status: 'CLOSED', failures: 0, openedAt: null, openedAtISO: null },
        { product: 's3', status: 'OPEN', failures: 5, openedAt: at.getTime(), openedAtISO: at.toISOString() },
        { product: 'sns', status: 'HALF_OPEN', failures: 5, openedAt: at.getTime(), openedAtISO: at.toISOString() }
      ],
      activeFallbacks: 2,
      generatedAt: at.toISOString()
    });
    ok(ProvidersHealthSchema, health);
    expect(health.providers.map(p => p.availabilityStatus)).toEqual(['Disponible', 'No disponible', 'Degradado']);
  });

  it('fallback', () => {
    ok(FallbackEventSchema, dto.FallbackEventDTO(fallback as never));
  });
});
