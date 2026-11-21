// validate(): parsea body/query/params/files con Zod; si falla → 422 con { field, message, hint, value } (el
// formato de siempre, en español); si pasa, deja en req el valor ya parseado.
import type { NextFunction, Request, Response } from 'express';
import { z, withHint } from './z';
import { text, uuid, positiveInt } from './fields';
import { validate } from './validate';
import { toOpenApi } from './openapi';
import AppError from '../http/app-error.util';

const Body = z.object({ name: text('El nombre', { max: 5 }), id: uuid('El id').optional() });
const Query = z.object({ page: positiveInt('La página').default(1) });

function run(mw: ReturnType<typeof validate>, req: Partial<Request>) {
  const next = jest.fn() as unknown as NextFunction & jest.Mock;
  mw(req as Request, {} as Response, next);
  return { req, err: next.mock.calls[0]?.[0] as AppError | undefined };
}

describe('validate()', () => {
  it('si todo cumple, deja en req el valor parseado (recortado, convertido, sin campos de más)', () => {
    const { req, err } = run(validate({ body: Body, query: Query }), { body: { name: '  Ana ', extra: 'x' }, query: { page: '3' } });
    expect(err).toBeUndefined();
    expect(req.body).toEqual({ name: 'Ana' });
    expect(req.query).toEqual({ page: 3 });
  });

  it('si falla, 422 con campo, mensaje en español, pista y valor recibido', () => {
    const { err } = run(validate({ body: Body }), { body: { name: 'demasiado largo', id: 'x' } });
    expect(err).toBeInstanceOf(AppError);
    expect(err?.statusCode).toBe(422);
    expect(err?.details).toEqual(
      expect.arrayContaining([
        { field: 'name', message: 'El nombre admite máximo 5 caracteres', hint: 'Escribí hasta 5 caracteres', value: 'demasiado largo' },
        { field: 'id', message: 'El id debe ser un UUID válido', hint: 'El identificador debe ser un UUID válido', value: 'x' }
      ])
    );
  });

  it('junta los errores de todas las partes en una sola respuesta', () => {
    const { err } = run(validate({ body: Body, query: Query }), { body: {}, query: { page: '0' } });
    expect((err?.details as Array<{ field: string }>).map(e => e.field).sort()).toEqual(['name', 'page']);
  });

  it('files se valida pero no se reemplaza (el controller necesita el archivo completo)', () => {
    const files = { image: [{ mimetype: 'image/png', buffer: Buffer.from('x') }] };
    const { req, err } = run(validate({ files: z.object({ image: z.array(z.object({ mimetype: z.literal('image/png') })).min(1) }) }), { files } as unknown as Partial<Request>);
    expect(err).toBeUndefined();
    expect((req as { files: unknown }).files).toBe(files);
  });
});

describe('toOpenApi()', () => {
  it('genera el schema OpenAPI 3.0 desde el mismo esquema, con la pista como x-hint', () => {
    const schema = toOpenApi(z.object({ tag: withHint(z.string().max(3).nullish(), { hint: 'Corto' }) }));
    expect(schema).toMatchObject({
      type: 'object',
      properties: { tag: { type: 'string', maxLength: 3, nullable: true, 'x-hint': 'Corto' } }
    });
    expect(JSON.stringify(schema)).not.toContain('"hint"');
  });
});
