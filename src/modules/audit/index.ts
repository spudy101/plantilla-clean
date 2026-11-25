// API pública del módulo audit para los módulos que todavía no están en Clean Architecture (iam,
// approvals).
//
// En Clean, audit no se usa importando este index: src/main/container.ts arma el módulo (createAuditModule en
// audit.module.ts) y entrega su AuditTrail a los módulos migrados. Lo que queda acá es TRANSITORIO: la
// escritura de auditoría, las lecturas que hace iam (intentos de autenticación, historial de cambios de un
// usuario) y los intentos de login, que son de iam. Cuando esos módulos se migren, se borra.
import { interopDefault } from '../../shared/kernel/interop.util';
import type { PrismaAuditLogRepository } from './infrastructure/persistence/prisma-audit-log.repository';
import type { PrismaChangeLogRepository } from './infrastructure/persistence/prisma-change-log.repository';
import type { PrismaUserLoginAttemptRepository } from './infrastructure/persistence/prisma-user-login-attempt.repository';

/** Una instancia de la clase exportada `name`; si el módulo está reemplazado por un jest.mock (objeto plano), el mock. */
function instanceOf<T>(mod: unknown, name: string): T {
  const Ctor = (mod as Record<string, unknown>)[name];
  return (typeof Ctor === 'function' ? new (Ctor as new () => T)() : mod) as T;
}

/** Una instancia por pieza, creada al primer uso (los index se cargan perezosamente: ver ARCHITECTURE.md). */
const instances = new Map<string, unknown>();
function lazy<T>(key: string, create: () => T): T {
  if (!instances.has(key)) {
    instances.set(key, create());
  }
  return instances.get(key) as T;
}

export default {
  /** @deprecated Transitorio: audit.record(acción, hecho) y audit.recordChange(cambio). */
  get audit() {
    return interopDefault(require('./infrastructure/legacy/audit-recorder') as typeof import('./infrastructure/legacy/audit-recorder'));
  },

  /** @deprecated Transitorio para iam (intentos de autenticación de la vista de sesiones). */
  get auditLogRepository(): Pick<PrismaAuditLogRepository, 'findAuthAttemptsPaginated'> {
    return lazy('auditLogs', () =>
      instanceOf<PrismaAuditLogRepository>(require('./infrastructure/persistence/prisma-audit-log.repository'), 'PrismaAuditLogRepository')
    );
  },

  /** @deprecated Transitorio para iam (historial de cambios de un usuario interno). */
  get userChangeLogRepository(): Pick<PrismaChangeLogRepository, 'findByUserId'> {
    return lazy('changeLogs', () =>
      instanceOf<PrismaChangeLogRepository>(require('./infrastructure/persistence/prisma-change-log.repository'), 'PrismaChangeLogRepository')
    );
  },

  /** @deprecated Transitorio para iam: los intentos de login son suyos y se mudan al migrarlo. */
  get userLoginAttemptRepository(): Pick<PrismaUserLoginAttemptRepository, 'recordAttempt' | 'checkIfBlocked'> {
    return lazy('loginAttempts', () =>
      instanceOf<PrismaUserLoginAttemptRepository>(
        require('./infrastructure/persistence/prisma-user-login-attempt.repository'),
        'PrismaUserLoginAttemptRepository'
      )
    );
  }
};

export type { AuditActionKey } from './domain/audit-action';
export type { AccountChange as ChangeInput, ChangeType } from './domain/account-change';
export type { AuditLogWithExecutor } from './domain/audit-log';
