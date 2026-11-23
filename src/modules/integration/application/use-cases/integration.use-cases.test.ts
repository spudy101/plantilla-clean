// Casos de uso de integration con dobles en memoria de sus puertos: sin jest.mock, sin Prisma, sin Redis.
import { GetProvidersHealth } from './get-providers-health.use-case';
import { ListFallbackHistory } from './list-fallback-history.use-case';
import { RecordFallbackOpened } from './record-fallback-opened.use-case';
import { RecordFallbackResolved } from './record-fallback-resolved.use-case';
import { RecordingAuditTrail, silentLogger } from '../../../../../tests/doubles/settings.doubles';
import {
  fallbackEvent,
  FixedCircuits,
  InMemoryFallbackEvents,
  StubFailedProcesses
} from '../../../../../tests/doubles/integration.doubles';

const ADMIN = 'admin-1';
const PAGE = { page: 1, limit: 10, sortBy: 'startedAt', order: 'DESC' as const };
const OPENED_AT = new Date('2026-11-18T10:00:00Z');

describe('GetProvidersHealth', () => {
  it('muestra el circuito de cada proveedor, cuenta las caídas abiertas y audita', async () => {
    const audit = new RecordingAuditTrail();
    const circuits = new FixedCircuits([
      { product: 'ses', state: 'CLOSED', failures: 0, openedAt: null },
      { product: 's3', state: 'OPEN', failures: 5, openedAt: OPENED_AT }
    ]);
    const fallbacks = new InMemoryFallbackEvents([fallbackEvent(), fallbackEvent({ endedAt: new Date() })]);

    const result = await new GetProvidersHealth(circuits, fallbacks, audit).execute({ actorId: ADMIN });

    expect(result.providers.map(p => [p.product, p.availabilityStatus])).toEqual([
      ['ses', 'Disponible'],
      ['s3', 'No disponible']
    ]);
    expect(result.activeFallbacks).toBe(1);
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'PROVIDER_HEALTH_DASHBOARD_VIEWED',
        actorId: ADMIN,
        details: { activeFallbacks: 1 },
        entityType: 'ProviderFallbackEvent'
      })
    ]);
  });
});

describe('ListFallbackHistory', () => {
  it('interpreta activeOnly y descarta null/false de los filtros aplicados', async () => {
    const audit = new RecordingAuditTrail();
    const fallbacks = new InMemoryFallbackEvents([fallbackEvent({ fallbackEventId: 'f-1', provider: 'aws_sns' })]);

    const query = { ...PAGE, provider: 'sns', activeOnly: true, from: new Date('2026-11-01') };
    const result = await new ListFallbackHistory(fallbacks, audit).execute({ actorId: ADMIN, query });

    expect(fallbacks.listCalls[0]?.filters).toEqual({ provider: 'sns', activeOnly: true, from: new Date('2026-11-01'), to: null });
    expect(fallbacks.listCalls[0]?.page).toMatchObject({ sortBy: 'startedAt', order: 'DESC', offset: 0 });
    expect(result.data[0]).toMatchObject({ fallbackEventId: 'f-1', active: true, durationSeconds: null });
    expect(result.metadata.filters).toEqual({ provider: 'sns', activeOnly: true, from: new Date('2026-11-01') });
    expect(result.metadata.sort).toEqual({ field: 'startedAt', order: 'DESC' });
    expect(audit.entries[0]).toMatchObject({ action: 'PROVIDER_FALLBACK_HISTORY_VIEWED', details: { totalItems: 1 } });
  });

  it('con activeOnly ausente (false) no lo lista como filtro aplicado', async () => {
    const result = await new ListFallbackHistory(new InMemoryFallbackEvents(), new RecordingAuditTrail()).execute({
      actorId: ADMIN,
      query: { ...PAGE, activeOnly: false, provider: '' }
    });
    expect(result.metadata.filters).toBeUndefined();
  });
});

describe('RecordFallbackOpened', () => {
  it('abre la ventana con el nombre del proveedor y audita la activación', async () => {
    const audit = new RecordingAuditTrail();
    const fallbacks = new InMemoryFallbackEvents();

    await new RecordFallbackOpened(fallbacks, audit, silentLogger).execute({ product: 'ses', openedAt: OPENED_AT });

    expect(fallbacks.opened).toEqual([{ provider: 'aws_ses', circuitProduct: 'ses', startedAt: OPENED_AT }]);
    expect(audit.entries).toEqual([
      {
        action: 'PROVIDER_FALLBACK_ACTIVATED',
        actorId: null,
        details: { provider: 'aws_ses', product: 'ses', openedAt: OPENED_AT.toISOString() }
      }
    ]);
  });
});

describe('RecordFallbackResolved', () => {
  it('cierra la ventana con duración y los procesos afectados', async () => {
    const audit = new RecordingAuditTrail();
    const fallbacks = new InMemoryFallbackEvents();

    await new RecordFallbackResolved(fallbacks, new StubFailedProcesses(4), audit, silentLogger).execute({
      product: 'aws_sms',
      openedAt: OPENED_AT
    });

    expect(fallbacks.closed).toEqual([
      expect.objectContaining({ provider: 'aws_sms', startedAt: OPENED_AT, endedAt: expect.any(Date), affectedCount: 4 })
    ]);
    expect(audit.entries[0]).toMatchObject({
      action: 'PROVIDER_FALLBACK_RESOLVED',
      actorId: null,
      details: { provider: 'aws_sms', product: 'aws_sms', affectedCount: 4, durationSeconds: expect.any(Number) }
    });
  });

  it('sin forma de contar (null) o si la cuenta falla → affectedCount null, y la ventana se cierra igual', async () => {
    for (const counter of [new StubFailedProcesses(null), new StubFailedProcesses(new Error('BD caída'))]) {
      const fallbacks = new InMemoryFallbackEvents();
      await new RecordFallbackResolved(fallbacks, counter, new RecordingAuditTrail(), silentLogger).execute({
        product: 's3',
        openedAt: OPENED_AT
      });
      expect(fallbacks.closed[0]).toMatchObject({ provider: 'aws_s3', affectedCount: null });
    }
  });
});
