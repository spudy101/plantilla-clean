// Errores de la base que llegan desde Prisma: las restricciones (409 UNIQUE con la etiqueta del campo,
// 400 FK, 404) y lo temporal (base no disponible → 503, conflicto de transacción → 409 temporal).

import ErrorMiddleware from './error.middleware';

function fakeRes() {
  const res = { statusCode: 0, body: undefined as unknown, status: jest.fn(), json: jest.fn(), set: jest.fn() };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

const prismaError = (code: string, meta: Record<string, unknown> = {}) => ({ name: 'PrismaClientKnownRequestError', code, meta });

describe('ErrorMiddleware — errores de Prisma', () => {
  const handle = (err: object) => {
    const res = fakeRes();
    ErrorMiddleware._handleKnownErrors(err as never, res as never, { correlationId: 'c-1' } as never);
    return res;
  };

  it('P2002 → 409 con la etiqueta del campo (nombre de campo de Prisma pasado a la columna)', () => {
    const res = handle(prismaError('P2002', { target: ['nationalId'] }));
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.body)).toContain('número de documento');
  });

  it('P2002 con los campos en la causa del adaptador y sin etiqueta → mensaje genérico', () => {
    const res = handle(prismaError('P2002', { driverAdapterError: { cause: { constraint: { fields: ['"code"'] } } } }));
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.body)).toContain('uno de los datos ingresados');
  });

  it('P2003 → 400 referencia inválida; P2025 → 404', () => {
    expect(handle(prismaError('P2003')).statusCode).toBe(400);
    expect(handle(prismaError('P2025')).statusCode).toBe(404);
  });

  it('otro código de Prisma (error de la consulta) → 500 permanente', () => {
    const res = handle(prismaError('P2010'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ errorCode: 'DATABASE_ERROR', retryable: false });
  });
});

describe('ErrorMiddleware — base no disponible o conflicto de transacción (temporales)', () => {
  const handle = (err: object) => {
    const res = fakeRes();
    ErrorMiddleware._handleKnownErrors(err as never, res as never, { correlationId: 'c-1' } as never);
    return res;
  };
  const adapterCause = (cause: object) => ({
    name: 'PrismaClientKnownRequestError',
    code: 'P2010',
    meta: { driverAdapterError: { cause } }
  });

  it.each([
    ['P1001 base inalcanzable', prismaError('P1001')],
    ['ECONNREFUSED sin traducir (así llega un puerto cerrado)', prismaError('ECONNREFUSED')],
    ['P1008 timeout', prismaError('P1008')],
    ['P1017 conexión cerrada', prismaError('P1017')],
    ['P2024 timeout esperando el pool', prismaError('P2024')],
    ['P2037 demasiadas conexiones', prismaError('P2037')],
    ['al conectar (PrismaClientInitializationError)', { name: 'PrismaClientInitializationError', errorCode: 'P1001' }],
    ['causa del adaptador: DatabaseNotReachable', adapterCause({ kind: 'DatabaseNotReachable' })],
    ['SQLSTATE 57P01 (la base se está apagando)', adapterCause({ kind: 'postgres', originalCode: '57P01' })],
    ['SQLSTATE 57014 (statement_timeout)', adapterCause({ kind: 'postgres', originalCode: '57014' })],
    ['timeout del pool de pg (sin traducir)', new Error('timeout exceeded when trying to connect')],
    ['envuelto en cause', Object.assign(new Error('falló'), { cause: new Error('Connection terminated unexpectedly') })]
  ])('%s → 503 DATABASE_UNAVAILABLE con Retry-After', (_label, err) => {
    const res = handle(err);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ errorCode: 'DATABASE_UNAVAILABLE', retryable: true });
    expect(res.set).toHaveBeenCalledWith('Retry-After', '5');
  });

  it.each([
    ['P2034', prismaError('P2034')],
    ['SQLSTATE 40P01 (deadlock)', adapterCause({ kind: 'TransactionWriteConflict', originalCode: '40P01' })],
    ['SQLSTATE 40001 (serialización)', adapterCause({ kind: 'TransactionWriteConflict', originalCode: '40001' })]
  ])('conflicto de transacción %s → 409 TRANSACTION_CONFLICT temporal', (_label, err) => {
    const res = handle(err);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ errorCode: 'TRANSACTION_CONFLICT', retryable: true });
  });

  it('una restricción UNIQUE sigue siendo 409 CONFLICT permanente (no se confunde con un conflicto de transacción)', () => {
    const res = handle(prismaError('P2002', { target: ['nationalId'] }));
    expect(res.body).toMatchObject({ errorCode: 'CONFLICT', retryable: false });
  });
});
