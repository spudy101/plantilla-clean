// Entidad: la configuración global del sistema. Hay una sola activa.
//
// Es TypeScript puro: no sabe de Prisma (la fila de la base la traduce infrastructure/persistence/
// system-global-config.mapper.ts) ni de HTTP. Sus reglas se prueban sin base de datos.
import { IntegrationResilience, type IntegrationResiliencePatch } from './integration-resilience';

export interface AuditRetention {
  /** Años que los audit_logs quedan en la base (caliente). El worker de purga usa este corte. */
  hotYears: number;
  /** Años en S3 Glacier (frío). Informativo: el lifecycle de S3 vive en la infraestructura. */
  coldYears: number;
  /** Si el worker borra de la base los audit_logs vencidos (la copia queda en S3). */
  hotPurgeEnabled: boolean;
}

export interface SystemGlobalConfigProps {
  id: string;
  /** Se incrementa en cada actualización. */
  version: number;
  /** Código ISO 4217. */
  currency: string;
  auditRetention: AuditRetention;
  integrationResilience: IntegrationResilience;
}

/** Lo que un administrador pide cambiar. Todo opcional: actualización parcial. */
export interface SystemGlobalConfigPatch {
  currency?: string;
  auditRetentionHotYears?: number;
  auditRetentionColdYears?: number;
  auditHotPurgeEnabled?: boolean;
  integrationResilience?: IntegrationResiliencePatch;
}

/**
 * Los cambios que hay que guardar, ya resueltos (la resiliencia viene fusionada con la actual).
 * No lleva la versión: la incrementa el repositorio de forma atómica al guardar.
 */
export interface SystemGlobalConfigChanges {
  currency?: string;
  auditRetentionHotYears?: number;
  auditRetentionColdYears?: number;
  auditHotPurgeEnabled?: boolean;
  integrationResilience?: IntegrationResilience;
}

export class SystemGlobalConfig {
  private constructor(private readonly props: Readonly<SystemGlobalConfigProps>) {}

  /** Reconstruye la entidad desde lo guardado (lo usa el mapper del repositorio). */
  static restore(props: SystemGlobalConfigProps): SystemGlobalConfig {
    return new SystemGlobalConfig({ ...props, auditRetention: { ...props.auditRetention } });
  }

  get id(): string {
    return this.props.id;
  }

  get version(): number {
    return this.props.version;
  }

  get currency(): string {
    return this.props.currency;
  }

  get auditRetention(): Readonly<AuditRetention> {
    return this.props.auditRetention;
  }

  get integrationResilience(): IntegrationResilience {
    return this.props.integrationResilience;
  }

  /** Qué hay que guardar para aplicar `patch`. Los campos no enviados no cambian. */
  changesFor(patch: SystemGlobalConfigPatch): SystemGlobalConfigChanges {
    const changes: SystemGlobalConfigChanges = {};
    if (patch.currency !== undefined) {
      changes.currency = patch.currency;
    }
    if (patch.auditRetentionHotYears !== undefined) {
      changes.auditRetentionHotYears = patch.auditRetentionHotYears;
    }
    if (patch.auditRetentionColdYears !== undefined) {
      changes.auditRetentionColdYears = patch.auditRetentionColdYears;
    }
    if (patch.auditHotPurgeEnabled !== undefined) {
      changes.auditHotPurgeEnabled = patch.auditHotPurgeEnabled;
    }
    if (patch.integrationResilience !== undefined) {
      changes.integrationResilience = this.props.integrationResilience.merge(patch.integrationResilience);
    }
    return changes;
  }
}
