// shared/observability/audit-hook.ts
//
// shared/ no conoce el módulo de auditoría (shared nunca importa de modules/), pero hay eventos de
// infraestructura que sí se auditan: un ciclo de worker que falla, Redis que se cae, un acceso
// denegado. Esos eventos se publican acá y la app conecta el módulo de auditoría al arrancar
// (src/app.ts → registerAuditSink).
import loggerUtilModule from './logger.util';
const { logger } = loggerUtilModule;

export interface InfraAuditEvent {
  action: string;
  actorId?: string | null;
  details?: Record<string, unknown>;
  outcome?: 'success' | 'failure' | 'warning' | 'attempt';
  entityType?: string | null;
  entityTable?: string | null;
}

type AuditSink = (event: InfraAuditEvent) => Promise<void>;

let sink: AuditSink | null = null;

export function registerAuditSink(fn: AuditSink): void {
  sink = fn;
}

/** Registra un evento de infraestructura en la auditoría. Nunca lanza ni bloquea a quien lo emite. */
export function auditInfraEvent(event: InfraAuditEvent): void {
  if (!sink) {
    logger.warn('Evento de auditoría sin destino registrado', { action: event.action });
    return;
  }
  sink(event).catch((error: unknown) => {
    logger.error('No se pudo auditar el evento de infraestructura', {
      action: event.action,
      error: error instanceof Error ? error.message : String(error)
    });
  });
}

export default { registerAuditSink, auditInfraEvent };
