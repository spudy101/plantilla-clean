// tests/doubles/settings.doubles.ts
//
// Dobles en memoria de los puertos de settings, para los tests de los casos de uso.
//
// Como los casos de uso dependen de interfaces, un test no necesita jest.mock ni Prisma: les pasa estas
// implementaciones y mira qué quedó guardado, auditado o notificado.
import type { AuditEntry, AuditTrail } from '../../src/shared/application/ports/audit-trail.port';
import type { Notification, Notifier } from '../../src/shared/application/ports/notifier.port';
import type { Logger } from '../../src/shared/application/ports/logger.port';
import type { SystemGlobalConfigRepository } from '../../src/modules/settings/application/ports/system-global-config-repository.port';
import {
  SystemGlobalConfig,
  type SystemGlobalConfigChanges,
  type SystemGlobalConfigProps
} from '../../src/modules/settings/domain/system-global-config';
import { IntegrationResilience } from '../../src/modules/settings/domain/integration-resilience';

export const DEFAULT_CONFIG: SystemGlobalConfigProps = {
  id: 'cfg-1',
  version: 3,
  currency: 'CLP',
  auditRetention: { hotYears: 5, coldYears: 10, hotPurgeEnabled: false },
  integrationResilience: IntegrationResilience.of({
    timeoutMs: 1000,
    circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 30000 }
  })
};

/** Repositorio en memoria: una sola configuración (o ninguna). */
export class InMemorySystemGlobalConfigRepository implements SystemGlobalConfigRepository {
  constructor(private stored: SystemGlobalConfigProps | null = { ...DEFAULT_CONFIG }) {}

  readonly appliedChanges: SystemGlobalConfigChanges[] = [];

  async findActive() {
    return this.stored ? SystemGlobalConfig.restore(this.stored) : null;
  }

  async createDefault() {
    this.stored = { ...DEFAULT_CONFIG, id: 'cfg-new', version: 1, integrationResilience: IntegrationResilience.of() };
    return SystemGlobalConfig.restore(this.stored);
  }

  async applyChanges(configId: string, changes: SystemGlobalConfigChanges) {
    if (!this.stored || this.stored.id !== configId) {
      return null;
    }
    this.appliedChanges.push(changes);
    const s = this.stored;
    this.stored = {
      ...s,
      version: s.version + 1,
      currency: changes.currency ?? s.currency,
      auditRetention: {
        hotYears: changes.auditRetentionHotYears ?? s.auditRetention.hotYears,
        coldYears: changes.auditRetentionColdYears ?? s.auditRetention.coldYears,
        hotPurgeEnabled: changes.auditHotPurgeEnabled ?? s.auditRetention.hotPurgeEnabled
      },
      integrationResilience: changes.integrationResilience ?? s.integrationResilience
    };
    return SystemGlobalConfig.restore(this.stored);
  }

  /** Simula que la fila desaparece entre la lectura y la escritura. */
  vanishOnWrite() {
    this.applyChanges = async () => null;
  }
}

export class RecordingAuditTrail implements AuditTrail {
  readonly entries: Array<{ action: string } & AuditEntry> = [];
  async record(action: string, entry: AuditEntry) {
    this.entries.push({ action, ...entry });
  }
}

export class RecordingNotifier implements Notifier {
  readonly sent: Notification[] = [];
  failWith: Error | null = null;
  async notify(notification: Notification) {
    if (this.failWith) {
      throw this.failWith;
    }
    this.sent.push(notification);
  }
}

export const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
