// El contrato de los listados paginados: la entrada (pageQuery / pagingQuery, shared/validation/fields.ts),
// el pedido de página (pageRequest), la metadata de la respuesta (pageMetadata) y el orden que aplica el
// repositorio (PrismaRepository.paginationArgs). Lógica pura: sin base ni HTTP.

import { z } from '../presentation/validation/z';
import { pageQuery, pagingQuery } from '../presentation/validation/fields';
import PrismaRepository from '../infrastructure/database/prisma.repository';
import { appliedFilters, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageMetadata, pageOf, pageRequest } from './pagination';

const ListQuery = z.object({ ...pageQuery(['createdAt', 'name'], { sortBy: 'createdAt' }), status: z.string().optional() });
const messages = (input: unknown) => (ListQuery.safeParse(input).error?.issues ?? []).map(i => `${i.path.join('.')}: ${i.message}`);

describe('pageQuery', () => {
  it('aplica los defaults: página 1, el tamaño por defecto y el orden declarado', () => {
    expect(ListQuery.parse({})).toEqual({ page: 1, limit: DEFAULT_PAGE_SIZE, sortBy: 'createdAt', order: 'DESC' });
  });

  it('convierte page/limit desde texto y deja order en mayúsculas', () => {
    expect(ListQuery.parse({ page: '3', limit: '25', sortBy: 'name', order: 'asc' })).toMatchObject({ page: 3, limit: 25, sortBy: 'name', order: 'ASC' });
  });

  it('acepta el nombre de columna (created_at) y lo devuelve como campo (createdAt)', () => {
    expect(ListQuery.parse({ sortBy: 'created_at' }).sortBy).toBe('createdAt');
  });

  it('un sortBy fuera de los campos declarados es un error (no se ignora en silencio)', () => {
    expect(messages({ sortBy: 'passwordHash' })).toEqual(['sortBy: sortBy debe ser uno de: createdAt, name']);
  });

  it.each([['0'], ['-1'], ['1.5'], ['abc']])('rechaza page=%p', page => {
    expect(ListQuery.safeParse({ page }).success).toBe(false);
  });

  it(`limita el tamaño de página a ${MAX_PAGE_SIZE}`, () => {
    expect(ListQuery.safeParse({ limit: String(MAX_PAGE_SIZE) }).success).toBe(true);
    expect(ListQuery.safeParse({ limit: String(MAX_PAGE_SIZE + 1) }).success).toBe(false);
  });

  it('rechaza un order que no sea ASC/DESC', () => {
    expect(messages({ order: 'up' })).toEqual(['order: El orden debe ser ASC o DESC']);
  });

  it('respeta el orden por defecto que declara el listado', () => {
    const Timeline = z.object(pageQuery(['createdAt'], { sortBy: 'createdAt', order: 'ASC' }));
    expect(Timeline.parse({}).order).toBe('ASC');
  });
});

describe('pagingQuery (listados de orden fijo)', () => {
  it('solo pagina: no ofrece sortBy ni order, y lo que llegue se descarta', () => {
    expect(z.object(pagingQuery).parse({ page: '2', sortBy: 'name', order: 'ASC' })).toEqual({ page: 2, limit: DEFAULT_PAGE_SIZE });
  });
});

describe('pageRequest', () => {
  it('agrega el offset de la página', () => {
    expect(pageRequest({ page: 3, limit: 20, sortBy: 'name', order: 'ASC' })).toEqual({ page: 3, limit: 20, offset: 40, sortBy: 'name', order: 'ASC' });
  });
});

describe('pageMetadata', () => {
  const page = { page: 2, limit: 10, sortBy: 'name', order: 'ASC' as const };

  it('calcula la paginación e informa el orden aplicado', () => {
    expect(pageMetadata(page, 25)).toEqual({
      pagination: { currentPage: 2, pageSize: 10, totalItems: 25, totalPages: 3, hasNextPage: true, hasPreviousPage: true },
      sort: { field: 'name', order: 'ASC' }
    });
  });

  it('sin resultados: 0 páginas, sin siguiente', () => {
    expect(pageMetadata({ ...page, page: 1 }, 0).pagination).toEqual({
      currentPage: 1,
      pageSize: 10,
      totalItems: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false
    });
  });

  it('informa solo los filtros con valor (false y 0 cuentan), y omite filters si no queda ninguno', () => {
    expect(pageMetadata(page, 1, { status: 'active', isActive: false, count: 0, search: '', userId: null, from: undefined }).filters).toEqual({
      status: 'active',
      isActive: false,
      count: 0
    });
    expect(pageMetadata(page, 1, { search: undefined })).not.toHaveProperty('filters');
  });

  it('pageOf arma { data, metadata }', () => {
    expect(pageOf([{ id: 1 }], page, 1)).toEqual({ data: [{ id: 1 }], metadata: pageMetadata(page, 1) });
  });

  it('appliedFilters sin argumento devuelve {}', () => {
    expect(appliedFilters()).toEqual({});
  });
});

describe('PrismaRepository.paginationArgs', () => {
  class Repo extends PrismaRepository {
    args(...a: Parameters<PrismaRepository['paginationArgs']>) {
      return this.paginationArgs(...a);
    }
  }
  const repo = new Repo({} as never);
  const req = pageRequest({ page: 2, limit: 10, sortBy: 'name', order: 'ASC' });

  it('ordena por el campo pedido y desempata por la clave primaria (orden estable entre páginas)', () => {
    expect(repo.args(req, 'genderId')).toEqual({ take: 10, skip: 10, orderBy: [{ name: 'asc' }, { genderId: 'asc' }] });
  });

  it('no repite el desempate si ya se ordena por la clave primaria', () => {
    expect(repo.args({ ...req, sortBy: 'genderId', order: 'DESC' }, 'genderId').orderBy).toEqual([{ genderId: 'desc' }]);
  });
});
