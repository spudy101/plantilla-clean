// API pública del módulo audit: lo ÚNICO que otros módulos (y src/app.ts) pueden importar.
// Lo que no está acá es interno del módulo (docs/ARCHITECTURE.md, regla 2).
//
// Cada export se carga al usarse (getter): los módulos se usan entre sí y un index que cargara todo
// de una vez crearía ciclos de carga. Uso: import auditModule from '…/audit'; const { X } = auditModule;
import { interopDefault } from '../../shared/kernel/interop.util';

export default {
  get audit() {
    return interopDefault(require('./audit.service') as typeof import('./audit.service'));
  },

  get auditComponentsDto() {
    return interopDefault(require('./responses/audit-components.response') as typeof import('./responses/audit-components.response'));
  },

  get auditAlertRepository() {
    return interopDefault(require('./repositories/audit-alert.repository') as typeof import('./repositories/audit-alert.repository'));
  },

  get auditLogRepository() {
    return interopDefault(require('./repositories/audit-log.repository') as typeof import('./repositories/audit-log.repository'));
  },

  get userChangeLogRepository() {
    return interopDefault(require('./repositories/change-log.repository') as typeof import('./repositories/change-log.repository'));
  },

  get userLoginAttemptRepository() {
    return interopDefault(require('./repositories/user-login-attempt.repository') as typeof import('./repositories/user-login-attempt.repository'));
  },

  get loadUserRefs() {
    return (require('./repositories/user-ref') as typeof import('./repositories/user-ref')).loadUserRefs;
  },

  get adminAuditActionCatalogRoutes() {
    return interopDefault(require('./routes/admin-audit-action-catalog.routes') as typeof import('./routes/admin-audit-action-catalog.routes'));
  },

  get adminAuditAlertRoutes() {
    return interopDefault(require('./routes/admin-audit-alert.routes') as typeof import('./routes/admin-audit-alert.routes'));
  },

  get adminAuditLogRoutes() {
    return interopDefault(require('./routes/admin-audit-log.routes') as typeof import('./routes/admin-audit-log.routes'));
  },

  get adminChangeLogRoutes() {
    return interopDefault(require('./routes/admin-change-log.routes') as typeof import('./routes/admin-change-log.routes'));
  },

  get adminOperationRoutes() {
    return interopDefault(require('./routes/admin-operation.routes') as typeof import('./routes/admin-operation.routes'));
  },

  get adminSessionTraceRoutes() {
    return interopDefault(require('./routes/admin-session-trace.routes') as typeof import('./routes/admin-session-trace.routes'));
  },

  get userActivityRoutes() {
    return interopDefault(require('./routes/user-activity.routes') as typeof import('./routes/user-activity.routes'));
  },

  get adminAuditContextUtil() {
    return interopDefault(require('./utils/admin-audit-context.util') as typeof import('./utils/admin-audit-context.util'));
  },

  get auditDiffUtil() {
    return interopDefault(require('./utils/audit-diff.util') as typeof import('./utils/audit-diff.util'));
  },

  get AuditArchiveWorker() {
    return interopDefault(require('./workers/audit-archive.worker') as typeof import('./workers/audit-archive.worker'));
  }
};

export type { AuditActionKey, ChangeInput, ChangeType } from './audit.service';
export type { AuditLogWithExecutor } from './repositories/audit-log.repository';
export type { UserRef } from './repositories/user-ref';
