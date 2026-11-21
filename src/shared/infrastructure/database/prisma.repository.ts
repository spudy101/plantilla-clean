// shared/repositories/prisma.repository.ts
//
// Base de todos los repositorios. Los services dependen del repositorio, nunca del cliente de Prisma
// (SOLID: D): el ORM no sale de esta capa.
//
// `await this.db()` es el cliente con el que consulta el repositorio: el de la transacción de la unidad
// de trabajo si el llamador está dentro de `unitOfWork.run()` (shared/database/transaction-context.ts),
// si no el cliente único. Los repositorios no reciben ni pasan
// transacciones.
//
// Los listados reciben el pedido de página (`PageRequest`, shared/http/pagination.ts) y devuelven
// `{ rows, count }`: el mismo contrato en todos los repositorios.
import prisma from './prisma';
import txContext from './transaction-context';
import type { Prisma } from './generated/prisma/client';
import type { PageRequest } from '../../application/pagination';

type PrismaClientInstance = typeof prisma;
/** Lo que ve un repositorio: los delegates de los modelos (el cliente único o el de una transacción). */
type PrismaDb = Prisma.TransactionClient;

abstract class PrismaRepository {
  private readonly _client: PrismaDb;

  /** @param client cliente inyectable (tests); por defecto el único de la app. */
  constructor(client: PrismaDb | PrismaClientInstance = prisma) {
    // El cliente único lleva piiExtension ($extends): una extensión de consulta no cambia los tipos de
    // los modelos, pero TS no reconoce el cliente extendido como TransactionClient
    this._client = client as PrismaDb;
  }

  /** Cliente de la transacción de la unidad de trabajo en curso, o el cliente por defecto. */
  protected db(): Promise<PrismaDb> {
    const unit = txContext.activeUnit();
    return unit ? unit.prisma() : Promise.resolve(this._client);
  }

  /**
   * Cliente por defecto, aunque haya una unidad de trabajo activa. Para escrituras que deben quedar aunque
   * el flujo que las disparó se revierta (bitácoras de auditoría).
   */
  protected independentDb(): PrismaDb {
    return this._client;
  }

  /** `$transaction` propia, fuera de cualquier unidad de trabajo (p. ej. un SET LOCAL + borrado). */
  protected ownTransaction<T>(fn: (db: PrismaDb) => Promise<T>): Promise<T> {
    return (this._client as unknown as PrismaClientInstance).$transaction(tx => fn(tx as PrismaDb));
  }

  /**
   * Ejecuta `fn` de forma atómica: dentro de `unitOfWork.run()` se une a su transacción; fuera, abre
   * una propia (`$transaction`). Para escrituras de varios pasos que no deben quedar a medias aunque
   * el llamador no haya pedido una unidad de trabajo (p. ej. "desactivar la anterior + crear").
   */
  protected async atomic<T>(fn: (db: PrismaDb) => Promise<T>): Promise<T> {
    const unit = txContext.activeUnit();
    if (unit) {
      return fn(await unit.prisma());
    }
    return (this._client as unknown as PrismaClientInstance).$transaction(tx => fn(tx as PrismaDb));
  }

  /**
   * skip/take/orderBy de un listado paginado. `sortBy` ya viene validado contra los campos ordenables que
   * declara el esquema del request (`pageQuery`): acá no se elige ni se corrige, se aplica tal cual, así
   * la metadata de la respuesta dice el orden real. El desempate por `tiebreaker` (la clave primaria) da
   * un orden estable: sin él, filas con el mismo valor pueden repetirse o faltar entre páginas.
   */
  protected paginationArgs({ limit, offset, sortBy, order }: PageRequest, tiebreaker?: string) {
    const direction = order === 'ASC' ? ('asc' as const) : ('desc' as const);
    return {
      take: limit,
      skip: offset,
      orderBy: [{ [sortBy]: direction }, ...(tiebreaker && tiebreaker !== sortBy ? [{ [tiebreaker]: direction }] : [])]
    };
  }

  /** `OR` de `contains` sin distinguir mayúsculas (iLike); `{}` sin término. */
  protected searchWhere(searchTerm: string | null | undefined, fields: readonly string[]) {
    if (!searchTerm || fields.length === 0) {
      return {};
    }
    return { OR: fields.map(f => ({ [f]: { contains: searchTerm, mode: 'insensitive' as const } })) };
  }

  /**
   * `where` + paginación de un listado de catálogo, con el contrato `{ rows, count }`:
   * `filters.isActive` → isActive; `filterId` mapea un filtro de la query (p. ej. `countryId`) a su
   * campo; `searchTerm` busca sin mayúsculas en `searchFields`. El `where` sale sin tipo de modelo: el
   * repositorio lo castea a su `Prisma.XWhereInput` (los nombres vienen de su propia config).
   */
  protected listQuery(
    filters: PrismaRepository.Filters,
    pagination: PageRequest,
    searchTerm: string | null | undefined,
    config: PrismaRepository.ListConfig
  ) {
    const where: Record<string, unknown> = {
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...this.searchWhere(searchTerm, config.searchFields ?? [])
    };
    if (config.filterId && filters[config.filterId.key]) {
      where[config.filterId.field] = filters[config.filterId.key];
    }
    return { where, page: this.paginationArgs(pagination, config.tiebreaker) };
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace PrismaRepository {
  export type Db = PrismaDb;
  export type Filters = { isActive?: boolean } & Record<string, unknown>;
  export interface ListConfig {
    /** Clave primaria del modelo: desempata el orden para que la paginación sea estable. */
    tiebreaker: string;
    searchFields?: readonly string[];
    /** Filtro por id padre: `filters[key]` → `where[field]` (ej. countryId → countryId). */
    filterId?: { key: string; field: string };
  }
  /** Resultado de un listado paginado (`{ rows, count }`). */
  export interface Page<Row> {
    rows: Row[];
    count: number;
  }
}

export default PrismaRepository;
