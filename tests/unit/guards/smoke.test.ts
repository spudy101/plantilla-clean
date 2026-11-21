// tests/unit/guards/smoke.test.ts
// Test de humo mínimo para verificar que la infraestructura de test funciona y que el cliente de Prisma
// (con la extensión de PII) carga sin conectarse: el pool de pg conecta recién en la primera consulta.

import { interopDefault } from '../../../src/shared/kernel/interop.util';
describe('smoke', () => {
  it('el entorno de test está activo', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('el cliente de Prisma carga y expone los modelos core', () => {
    const prisma = interopDefault(require('../../../src/shared/infrastructure/database/prisma') as typeof import('../../../src/shared/infrastructure/database/prisma'));
    expect(prisma.user).toBeDefined();
    expect(prisma.person).toBeDefined();
    expect(prisma.userSession).toBeDefined();
    expect(prisma.auditLog).toBeDefined();
    expect(prisma.approvalRequest).toBeDefined();
    expect(prisma.notification).toBeDefined();
  });
});
