// El mapper es la frontera con las filas de Prisma: la copia fría de S3 serializa la entidad tal cual, así
// que debe conservar todas las columnas en el orden de la tabla.
import type { AuditLog } from '../../../../shared/infrastructure/database/generated/prisma/client';
import { AuditMapper } from './audit.mapper';

const AT = new Date('2026-01-01T00:00:00Z');
const row: AuditLog = {
  auditLogId: 'a-1',
  action: 'USER_FIELD_CHANGED',
  description: 'Cambio',
  category: 'Perfil',
  risk: 'medium',
  outcome: 'success',
  userId: 'admin-1',
  correlationId: 'c-1',
  ip: '10.0.0.1',
  userAgent: 'jest',
  fingerprint: 'fp',
  details: { changeType: 'email', changedByRole: 'admin', previousValue: 'a@b.co', newValue: 'c@d.co' },
  source: 'http',
  entityId: 'user-1',
  entityType: 'User',
  entityTable: 'users',
  module: 'admin',
  sessionId: 's-1',
  createdAt: AT,
  updatedAt: AT
};

describe('AuditMapper', () => {
  it('registro: todas las columnas, en el orden de la tabla', () => {
    expect(JSON.stringify(AuditMapper.auditLogToDomain(row))).toBe(JSON.stringify(row));
  });

  it('cambio de la bitácora: el afectado es entity_id, quién lo hizo es user_id y los datos salen de details', () => {
    expect(AuditMapper.changeLogToDomain(row)).toEqual({
      logId: 'a-1',
      userId: 'user-1',
      changedByUserId: 'admin-1',
      changedByRole: 'admin',
      changeType: 'email',
      previousValue: 'a@b.co',
      newValue: 'c@d.co',
      changeReason: null,
      ipAddress: '10.0.0.1',
      userAgent: 'jest',
      originSessionId: 's-1',
      createdAt: AT
    });
    expect(AuditMapper.changeLogToDomain({ ...row, details: null }).changedByRole).toBe('system');
  });
});
