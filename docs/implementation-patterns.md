# Patrones de implementación — plantillas de código

> Plantillas canónicas por capa para un feature nuevo, en **Clean Architecture** (ver
> [`CLEAN-ARCHITECTURE.md`](CLEAN-ARCHITECTURE.md)). Salen del módulo `settings`, el molde: cuando dudes, abrí el
> archivo real que cita cada sección. Todo es TypeScript estricto; `tests/unit/guards/clean-architecture.test.ts`
> falla si una capa importa lo que no debe.

El ejemplo es un módulo `catalog` con productos. Archivos de un feature, de adentro hacia afuera:

```
src/modules/catalog/
  domain/product.ts                              entidad + reglas            (TypeScript puro)
  domain/errors.ts                               errores del dominio
  application/ports/product-repository.port.ts   lo que el caso de uso NECESITA (interfaz)
  application/dto/product.output.ts              lo que devuelve el caso de uso (datos planos)
  application/use-cases/create-product.use-case.ts
  infrastructure/persistence/product.mapper.ts   fila de Prisma ↔ entidad
  infrastructure/persistence/prisma-product.repository.ts
  presentation/http/requests/product.request.ts  entrada (Zod)
  presentation/http/responses/product.response.ts salida (Zod, documenta Swagger)
  presentation/http/product.controller.ts
  presentation/http/product.routes.ts            factory: recibe controller + guardas
  presentation/http/docs/product.paths.ts        OpenAPI
  catalog.module.ts                              composición (el único que conoce todas las capas)
tests/doubles/catalog.doubles.ts                 dobles en memoria de los puertos
```

## Dominio — entidad y errores

Molde: `src/modules/settings/domain/system-global-config.ts`, `domain/errors.ts`.

```ts
// domain/product.ts — no importa Prisma, Express ni paquetes npm
import { InvalidPriceError } from './errors';

export interface ProductProps {
  id: string;
  name: string;
  priceCents: number;
  isActive: boolean;
}

export class Product {
  private constructor(private readonly props: Readonly<ProductProps>) {}

  /** Un producto nuevo: acá viven las reglas de creación. */
  static create(props: Omit<ProductProps, 'isActive'>): Product {
    if (props.priceCents <= 0) {
      throw new InvalidPriceError();
    }
    return new Product({ ...props, isActive: true });
  }

  /** Reconstruye desde lo guardado (lo usa el mapper): no revalida. */
  static restore(props: ProductProps): Product {
    return new Product({ ...props });
  }

  get id() {
    return this.props.id;
  }
  get name() {
    return this.props.name;
  }
  get priceCents() {
    return this.props.priceCents;
  }
  get isActive() {
    return this.props.isActive;
  }
}
```

```ts
// domain/errors.ts — dicen QUÉ regla se rompió; el status HTTP lo decide la presentación
import { ConflictError, RuleViolationError } from '../../../shared/domain/errors/domain-error';

export class InvalidPriceError extends RuleViolationError {
  constructor() {
    super('El precio debe ser mayor a cero', 'UNPROCESSABLE_ENTITY'); // → 422
  }
}

export class ProductNameTakenError extends ConflictError {
  constructor() {
    super('Ya existe un producto con ese nombre', 'CONFLICT'); // → 409
  }
}
```

> ✅ Familias (`shared/domain/errors/domain-error.ts`): `NotFoundError` 404 · `ConflictError` 409 ·
> `RuleViolationError` 422 · `InvalidInputError` 400 · `ForbiddenError` 403 · `UnauthorizedError` 401 ·
> `TooManyRequestsError` 429 · `InternalError` 500. El código (`'CONFLICT'`…) es el contrato con el front.
> ✅ Algo de lo que dependemos no está (un proveedor caído): `ServiceUnavailableError` de
> `shared/application/errors.ts` (503, con `retryAfterSeconds`). No es una regla de negocio.
> ❌ `AppError` es HTTP: solo existe en `presentation/`.

## Puerto

Molde: `src/modules/settings/application/ports/system-global-config-repository.port.ts`.

```ts
// application/ports/product-repository.port.ts — habla de entidades, no de filas
import type { PageRequest } from '../../../../shared/application/pagination';
import type { Product } from '../../domain/product';

export interface ProductRepository {
  findByName(name: string): Promise<Product | null>;
  list(filters: { isActive?: boolean }, page: PageRequest, search: string | null): Promise<{ rows: Product[]; count: number }>;
  save(product: Product): Promise<void>;
}
```

> ✅ Solo lo que el caso de uso usa (I de SOLID), con nombres de negocio. Un archivo `*.port.ts` por puerto,
> sin implementación (el guard lo verifica).
> ✅ Lo que viene de OTRO módulo (un usuario, una notificación) también es un puerto propio: el módulo no
> importa al otro; un adaptador de `src/main/adapters/` lo implementa.

## Caso de uso

Molde: `src/modules/settings/application/use-cases/update-system-global-config.use-case.ts`.

```ts
// application/use-cases/create-product.use-case.ts
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { IdGenerator } from '../../../../shared/application/ports/id-generator.port';
import type { ProductRepository } from '../ports/product-repository.port';
import { Product } from '../../domain/product';
import { ProductNameTakenError } from '../../domain/errors';
import { toProductOutput, type ProductOutput } from '../dto/product.output';

export interface CreateProductInput {
  actorId: string;
  name: string;
  priceCents: number;
}

export class CreateProduct {
  // Dependencias por constructor y obligatorias: el caso de uso no crea nada (`new XRepository()` lo prohíbe el guard)
  constructor(
    private readonly products: ProductRepository,
    private readonly ids: IdGenerator,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, name, priceCents }: CreateProductInput): Promise<ProductOutput> {
    if (await this.products.findByName(name)) {
      throw new ProductNameTakenError();
    }
    const product = Product.create({ id: this.ids.next(), name, priceCents }); // la regla del precio, en el dominio
    await this.products.save(product);

    await this.audit.record('PRODUCT_CREATED', {
      actorId,
      details: { name, priceCents },
      entityId: product.id,
      entityType: 'Product',
      entityTable: 'products'
    });
    return toProductOutput(product);
  }
}
```

> ✅ Una clase por acción, con `execute()`. Orquesta: lee por puertos, deja las reglas a la entidad, guarda,
> audita, avisa. Atomicidad: `UnitOfWork` (`await this.unitOfWork.run(async () => { … })`).
> ✅ Un aviso que no debe bloquear la respuesta: `notifier.notify(...).catch(err => logger.warn(...))`.
> ✅ Listados: `const page = pageRequest(query)` y `return pageOf(rows.map(toProductOutput), page, count, filtros)`
> (`shared/application/pagination.ts`): la metadata informa el orden y los filtros **aplicados**.

## DTO de salida

Molde: `src/modules/settings/application/dto/system-global-config.output.ts`.

```ts
// application/dto/product.output.ts — datos planos: la entidad puede cambiar por dentro sin romper la API
import type { Product } from '../../domain/product';

export interface ProductOutput {
  productId: string;
  name: string;
  priceCents: number;
  isActive: boolean;
}

export const toProductOutput = (product: Product): ProductOutput => ({
  productId: product.id,
  name: product.name,
  priceCents: product.priceCents,
  isActive: product.isActive
});
```

> ✅ Campo a campo, nunca un spread de la entidad o de una fila. PII: ver `docs/pii-masking.md` y `docs/dtos.md`.

## Infraestructura — mapper y repositorio

Molde: `src/modules/settings/infrastructure/persistence/`.

```ts
// infrastructure/persistence/product.mapper.ts — el único que conoce la forma de la fila
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import { Product } from '../../domain/product';

export const PRODUCT_COLUMNS = { productId: true, name: true, priceCents: true, isActive: true } satisfies Prisma.ProductSelect;
type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_COLUMNS }>;

export const ProductMapper = {
  toDomain: (row: ProductRow) => Product.restore({ id: row.productId, name: row.name, priceCents: row.priceCents, isActive: row.isActive }),
  toCreate: (product: Product): Prisma.ProductCreateInput => ({
    productId: product.id,
    name: product.name,
    priceCents: product.priceCents,
    isActive: product.isActive
  })
};
```

```ts
// infrastructure/persistence/prisma-product.repository.ts — implementa el puerto
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { ProductRepository } from '../../application/ports/product-repository.port';
import type { Product } from '../../domain/product';
import { ProductMapper, PRODUCT_COLUMNS } from './product.mapper';

export class PrismaProductRepository extends PrismaRepository implements ProductRepository {
  async findByName(name: string) {
    const row = await (await this.db()).product.findFirst({ where: { name }, select: PRODUCT_COLUMNS });
    return row ? ProductMapper.toDomain(row) : null;
  }

  async list(filters: { isActive?: boolean }, page: PageRequest, search: string | null) {
    const where = { ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}), ...this.searchWhere(search, ['name']) };
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.product.findMany({ where, select: PRODUCT_COLUMNS, ...this.paginationArgs(page, 'productId') }), // desempate por la PK
      db.product.count({ where })
    ]);
    return { rows: rows.map(ProductMapper.toDomain), count };
  }

  async save(product: Product) {
    await (await this.db()).product.create({ data: ProductMapper.toCreate(product) });
  }
}
```

> ✅ `await this.db()` toma la transacción si hay un `unitOfWork.run()` activo. Escrituras que deben quedar aunque
> el flujo se revierta (bitácoras) → `this.independentDb()`.
> ✅ Filtros, `select` e `include` viven acá. La PII se lee y escribe en claro: la extensión de
> `shared/infrastructure/database/prisma.ts` cifra y hashea; para buscar por un campo cifrado se filtra por su hash.
> ✅ Un error de un proveedor externo se traduce con `providerFailure(error, mensaje)`
> (`shared/infrastructure/providers/provider-errors.ts`): no disponible (503, reintentable) o interno (500).
> ❌ La infraestructura no lanza `AppError` (el guard lo verifica): lanza errores del dominio o técnicos.

## Presentación — request, response, controller, rutas

Molde: `src/modules/settings/presentation/http/`.

```ts
// presentation/http/requests/product.request.ts — valida, tipa y documenta la entrada
import { z } from '../../../../../shared/presentation/validation/z';
import { optionalBool, pageQuery, searchQuery, text } from '../../../../../shared/presentation/validation/fields';

export const CreateProductBody = z.object({ name: text('El nombre', { max: 120 }), priceCents: z.number().int() });
export type CreateProductBody = z.infer<typeof CreateProductBody>;

// Listado: los campos por los que se ordena (un sortBy fuera de la lista es un 422) y los filtros, ya tipados
export const ProductListQuery = z.object({ ...pageQuery(['createdAt', 'name'], { sortBy: 'createdAt' }), ...searchQuery, isActive: optionalBool('El estado') });
export type ProductListQuery = z.output<typeof ProductListQuery>;
```

```ts
// presentation/http/responses/product.response.ts — describe la salida del caso de uso (y Swagger)
import { z } from '../../../../../shared/presentation/validation/z';

export const ProductSchema = z.object({ productId: z.uuid(), name: z.string(), priceCents: z.number().int(), isActive: z.boolean() });

// responses/product.response.test.ts — conformidad: la salida del caso de uso cumple el esquema
// expect(ProductSchema.safeParse(toProductOutput(producto)).error?.issues ?? []).toEqual([]);
```

```ts
// presentation/http/product.controller.ts — HTTP ↔ caso de uso, sin reglas
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import type { CreateProduct } from '../../application/use-cases/create-product.use-case';
import type { CreateProductBody } from './requests/product.request';

const { asyncHandler } = errorMiddlewareModule;
const { requireAuthUser } = authUserUtilModule;

export class ProductController {
  constructor(private readonly createProduct: CreateProduct) {}

  create = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as CreateProductBody; // ya validado por validate({ body }) en la ruta
    const data = await this.createProduct.execute({ actorId: requireAuthUser(req).userId, ...body });
    return ApiResponse.success(res, 'Producto creado exitosamente', data, 201);
  });
}
```

```ts
// presentation/http/product.routes.ts — factory: no importa iam ni crea el controller
import express from 'express';
import type { Router } from 'express';
import { validate } from '../../../../shared/presentation/validation/validate';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';
import type { RouteGuards } from '../../../../shared/presentation/http/route-guards';
import rbacModule from '../../../../shared/domain/constants/rbac';
import { CreateProductBody } from './requests/product.request';
import type { ProductController } from './product.controller';

const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

export function createProductRouter(controller: ProductController, guards: RouteGuards): Router {
  const router = express.Router();
  router.post(
    '/products',
    guards.authenticate, // 1. quién llama (antes que RBAC)
    guards.requirePermission(RBAC_MODULES.PROMOTIONAL_CONTENT, RBAC_ACTIONS.CREATE), // 2. qué puede hacer
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ body: CreateProductBody }), // 422 con el detalle por campo
    controller.create
  );
  return router;
}
```

> ✅ No hay try/catch en el controller: `asyncHandler` lleva el error al manejador global, que traduce los del
> dominio y los técnicos (`shared/presentation/http/domain-error.mapper.ts`).
> ✅ `ApiResponse.success` aplana un `{ data, metadata }` (listado): pasar el resultado del caso de uso tal cual.
> ✅ `requireAuthUser(req)`, `routeParam(req, 'id')` y `adminAuditContext(req, res)`: no leer `req.user` /
> `req.params` a mano.

## Composición — `<módulo>.module.ts` y el container

Molde: `src/modules/settings/settings.module.ts` y `src/main/container.ts`.

```ts
// catalog.module.ts — el ÚNICO archivo del módulo que conoce todas sus capas
import type { Router } from 'express';
import type { AuditTrail } from '../../shared/application/ports/audit-trail.port';
import type { IdGenerator } from '../../shared/application/ports/id-generator.port';
import type { RouteGuards } from '../../shared/presentation/http/route-guards';
import { PrismaProductRepository } from './infrastructure/persistence/prisma-product.repository';
import { CreateProduct } from './application/use-cases/create-product.use-case';
import { ProductController } from './presentation/http/product.controller';
import { createProductRouter } from './presentation/http/product.routes';

export interface CatalogModuleDeps {
  audit: AuditTrail;
  ids: IdGenerator;
  guards: RouteGuards;
}

export function createCatalogModule({ audit, ids, guards }: CatalogModuleDeps) {
  const products = new PrismaProductRepository();
  const createProduct = new CreateProduct(products, ids, audit);
  return {
    adminRouter: createProductRouter(new ProductController(createProduct), guards),
    useCases: { createProduct } // lo que otros módulos pueden usar (por un adaptador de src/main/)
  };
}
```

```ts
// src/main/container.ts — crea el módulo con lo que viene de afuera
const catalog = createCatalogModule({ audit, ids: uuidGenerator, guards });

// src/main/app.ts — monta el router
router.use('/api/v1/core', container.catalog.adminRouter);
```

> ✅ El módulo no importa ningún otro: lo que necesita (auditoría, avisos, un usuario) llega por `deps`.
> ✅ Si otro módulo necesita algo de este, lo expone en `useCases` y un adaptador de `src/main/adapters/` lo conecta
> con el puerto del otro, leyendo el registro de módulos (`module-registry.ts`).

## Tests

Molde: `src/modules/settings/**/*.test.ts` y `tests/doubles/settings.doubles.ts`.

```ts
// tests/doubles/catalog.doubles.ts — implementación en memoria del puerto
export class InMemoryProducts implements ProductRepository {
  constructor(public products: Product[] = []) {}
  async findByName(name: string) {
    return this.products.find(p => p.name === name) ?? null;
  }
  async list() {
    return { rows: this.products, count: this.products.length };
  }
  async save(product: Product) {
    this.products.push(product);
  }
}
```

```ts
// application/use-cases/create-product.use-case.test.ts — sin jest.mock, sin Prisma, sin Express
it('crea el producto, lo guarda y audita', async () => {
  const products = new InMemoryProducts();
  const audit = new RecordingAuditTrail();
  const result = await new CreateProduct(products, { next: () => 'p-1' }, audit).execute({ actorId: 'admin-1', name: 'Té', priceCents: 1500 });

  expect(result).toEqual({ productId: 'p-1', name: 'Té', priceCents: 1500, isActive: true });
  expect(audit.entries).toEqual([expect.objectContaining({ action: 'PRODUCT_CREATED', entityId: 'p-1' })]);
});

it('un nombre repetido es un conflicto', async () => {
  const products = new InMemoryProducts([Product.create({ id: 'p-0', name: 'Té', priceCents: 100 })]);
  await expect(new CreateProduct(products, { next: () => 'p-1' }, new RecordingAuditTrail()).execute({ actorId: 'a', name: 'Té', priceCents: 1 })).rejects.toBeInstanceOf(
    ProductNameTakenError
  );
});
```

| Qué | Cómo |
|---|---|
| Dominio | TypeScript puro: `Product.create(...)` y sus reglas, sin dobles |
| Caso de uso | Dobles en memoria de los puertos (`tests/doubles/`) |
| Mapper | Fila de ejemplo ↔ entidad |
| Repositorio | Contra Postgres real (`tests/integration/`) |
| Respuesta | La salida del caso de uso cumple el esquema Zod |
| Arquitectura | `tests/unit/guards/clean-architecture.test.ts` (no hay que escribir nada: ya cubre el módulo nuevo) |

## Modelo y migración

No hay modelos en el código: la tabla se declara en `prisma/schema.prisma` (el cliente y sus tipos se
generan con `npm run prisma:generate`, que corre solo antes de `dev`, `build`, `typecheck` y `test`) y la
migración la genera Prisma (detalle en [`database.md`](database.md#cambiar-el-esquema)):

```prisma
model Product {
  productId  String   @id(map: "pk_products") @default(uuid()) @map("product_id") @db.Uuid
  name       String   @unique(map: "uq_products_name") @db.VarChar(120)
  priceCents Int      @map("price_cents")
  isActive   Boolean  @default(true) @map("is_active")
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt  DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@map("products")
}
```

```bash
npm run db:migrate:dev -- --name create-products   # genera prisma/migrations/<ts>_create-products/migration.sql
```

> ✅ Revisá el `migration.sql` generado antes de commitearlo; triggers, CHECK y comentarios se agregan a mano
> en ese archivo. Los datos base van en el seed (`prisma/seeds/`, `npm run db:seed`).
