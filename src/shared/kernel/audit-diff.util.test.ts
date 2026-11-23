// tests/unit/shared/audit-diff.util.test.ts
//
// buildAuditDiff: calcula el diff (before/after) entre el estado actual de una entidad (snake_case)
// y los datos entrantes del request (camelCase), según un fieldMap. Lógica pura, sin dependencias.

import auditDiffUtilModule from './audit-diff.util';
const { buildAuditDiff } = auditDiffUtilModule;

describe('buildAuditDiff', () => {
  it('incluye solo los campos que efectivamente cambian', () => {
    const entity = { name: 'Antiguo', role_type: 'X' };
    const data = { name: 'Nuevo', roleType: 'X' };
    const { before, after } = buildAuditDiff(entity, data, {
      name: 'name',
      roleType: 'role_type'
    });
    // name cambió; roleType es igual, así que se omite.
    expect(before).toEqual({ name: 'Antiguo' });
    expect(after).toEqual({ name: 'Nuevo' });
  });

  it('devuelve diff vacío cuando nada cambia', () => {
    const entity = { name: 'A', role_type: 'X' };
    const data = { name: 'A', roleType: 'X' };
    const { before, after } = buildAuditDiff(entity, data, { name: 'name', roleType: 'role_type' });
    expect(before).toEqual({});
    expect(after).toEqual({});
  });

  it('omite campos ausentes en data (undefined) sin marcarlos como cambio', () => {
    const entity = { name: 'A', technical_email: 'old@x.com' };
    const data = { name: 'B' }; // technicalEmail no viene en el request
    const { before, after } = buildAuditDiff(entity, data, {
      name: 'name',
      technicalEmail: 'technical_email'
    });
    expect(before).toEqual({ name: 'A' });
    expect(after).toEqual({ name: 'B' });
    expect(before).not.toHaveProperty('technicalEmail');
  });

  it('coacciona a null los valores nulos/undefined al registrar el cambio', () => {
    const entity = { note: undefined };
    const data = { note: 'algo' };
    const { before, after } = buildAuditDiff(entity, data, { note: 'note' });
    // currentValue undefined → null en el before.
    expect(before).toEqual({ note: null });
    expect(after).toEqual({ note: 'algo' });
  });

  it('registra el cambio de un valor a null', () => {
    const entity = { status: 'activo' };
    const data = { status: null };
    const { before, after } = buildAuditDiff(entity, data, { status: 'status' });
    expect(before).toEqual({ status: 'activo' });
    expect(after).toEqual({ status: null });
  });

  it('trata data[campo] = null como valor presente (no lo omite)', () => {
    const entity = { status: 'activo' };
    // null !== undefined, así que sí se evalúa y cambia.
    const { after } = buildAuditDiff(entity, { status: null }, { status: 'status' });
    expect(after).toEqual({ status: null });
  });

  it('devuelve estructuras vacías ante un fieldMap vacío', () => {
    const { before, after } = buildAuditDiff({ a: 1 }, { a: 2 }, {});
    expect(before).toEqual({});
    expect(after).toEqual({});
  });

  it('distingue tipos: no considera cambio entre valores idénticos', () => {
    const entity = { amount: 100 };
    const data = { amount: 100 };
    const { before, after } = buildAuditDiff(entity, data, { amount: 'amount' });
    expect(before).toEqual({});
    expect(after).toEqual({});
  });
});
