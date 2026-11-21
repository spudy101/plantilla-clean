// Adaptador: el puerto AuditTrail (shared/application) implementado con el módulo audit.
// Vive en src/main/ porque conecta dos módulos: los casos de uso no conocen audit, y audit no conoce a
// quién audita.
import auditModule from '../../modules/audit';
import type { AuditActionKey } from '../../modules/audit';
import type { AuditTrail } from '../../shared/application/ports/audit-trail.port';

export const auditTrailAdapter: AuditTrail = {
  record: (action, entry) => auditModule.audit.record(action as AuditActionKey, entry)
};
