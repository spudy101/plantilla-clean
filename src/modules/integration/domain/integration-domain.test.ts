// Reglas del dominio integration: nombres de proveedor, ventanas de fallback y disponibilidad.
import { FallbackEvent, durationSeconds, providerNameFor } from './fallback-event';
import { availabilityOf } from './provider-health';

const event = (over: Partial<Parameters<typeof FallbackEvent.restore>[0]> = {}) =>
  FallbackEvent.restore({
    fallbackEventId: 'f-1',
    provider: 'aws_ses',
    circuitProduct: 'ses',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    endedAt: null,
    affectedProcessesCount: null,
    ...over
  });

describe('providerNameFor', () => {
  it('traduce el producto del circuito al nombre del proveedor', () => {
    expect(['ses', 's3', 'sns', 'aws_sms'].map(providerNameFor)).toEqual(['aws_ses', 'aws_s3', 'aws_sns', 'aws_sms']);
  });

  it('un producto desconocido se nombra a sí mismo', () => {
    expect(providerNameFor('otro')).toBe('otro');
  });
});

describe('FallbackEvent', () => {
  it('sin fin está activa y no tiene duración', () => {
    expect(event().isActive).toBe(true);
    expect(event().durationSeconds).toBeNull();
  });

  it('cerrada: inactiva, con la duración redondeada a segundos', () => {
    const closed = event({ endedAt: new Date('2026-01-01T00:01:30.600Z') });
    expect(closed.isActive).toBe(false);
    expect(closed.durationSeconds).toBe(91);
  });

  it('durationSeconds redondea al segundo más cercano', () => {
    expect(durationSeconds(new Date(0), new Date(1499))).toBe(1);
    expect(durationSeconds(new Date(0), new Date(1500))).toBe(2);
  });
});

describe('availabilityOf', () => {
  it('cerrado → disponible, en prueba → degradado, abierto → no disponible', () => {
    expect(availabilityOf('CLOSED')).toBe('Disponible');
    expect(availabilityOf('HALF_OPEN')).toBe('Degradado');
    expect(availabilityOf('OPEN')).toBe('No disponible');
  });
});
