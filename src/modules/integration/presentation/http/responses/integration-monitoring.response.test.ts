// Conformidad: la salida de los casos de uso de integration cumple los esquemas que documenta Swagger.
import { FallbackEventSchema, ProvidersHealthSchema } from './integration-monitoring.response';
import { toFallbackEventOutput, toProvidersHealthOutput } from '../../../application/dto/integration-monitoring.output';
import { fallbackEvent } from '../../../../../../tests/doubles/integration.doubles';

const at = new Date('2026-01-01T00:00:00Z');

const ok = (schema: { safeParse(v: unknown): { error?: { issues: unknown[] } } }, value: unknown) =>
  expect(schema.safeParse(value).error?.issues ?? []).toEqual([]);

describe('Integration — salida conforme al esquema', () => {
  it('salud de proveedores: el estado del circuito se traduce a disponibilidad', () => {
    const health = toProvidersHealthOutput({
      circuits: [
        { product: 'ses', state: 'CLOSED', failures: 0, openedAt: null },
        { product: 's3', state: 'OPEN', failures: 5, openedAt: at },
        { product: 'sns', state: 'HALF_OPEN', failures: 5, openedAt: at }
      ],
      activeFallbacks: 2,
      generatedAt: at
    });
    ok(ProvidersHealthSchema.strict(), health);
    expect(health.providers.map(p => p.availabilityStatus)).toEqual(['Disponible', 'No disponible', 'Degradado']);
    expect(health.providers[1]?.circuit.openedAt).toBe(at.toISOString());
  });

  it('ventana de fallback (abierta y cerrada)', () => {
    ok(FallbackEventSchema.strict(), toFallbackEventOutput(fallbackEvent({ affectedProcessesCount: 3 })));
    ok(FallbackEventSchema.strict(), toFallbackEventOutput(fallbackEvent({ endedAt: new Date('2026-01-01T00:05:00Z') })));
  });
});
