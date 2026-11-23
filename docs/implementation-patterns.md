# Patrones de implementación — plantillas de código

> Plantillas canónicas por capa. **Leer esta guía antes de crear los archivos de un feature.**
> Todo es TypeScript estricto con imports/exports nativos (ver [`typescript-migration.md`](typescript-migration.md)):
> los módulos del proyecto exportan por defecto (`export default`) y se importan con `import X from '…'`.

## Controller

```ts
import MyService from '../services/my.service';
import ApiResponse from '../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../shared/presentation/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import routeParamUtilModule from '../../../shared/presentation/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authUserUtilModule from '../../iam/utils/auth-user.util';
const { requireAuthUser } = authUserUtilModule;
import adminAuditContextUtilModule from '../../../shared/presentation/http/admin-audit-context.util';
const { adminAuditContext } = adminAuditContextUtilModule;

class MyController {
  list = asyncHandler(async (req, res) => {
    const result = await MyService.list(req.query, requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Listado obtenido exitosamente', result);
  });

  getById = asyncHandler(async (req, res) => {
    const result = await MyService.getById(routeParam(req, 'id'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Recurso obtenido correctamente', result);
  });

  create = asyncHandler(async (req, res) => {
    const result = await MyService.create(req.body, adminAuditContext(req, res));
    return ApiResponse.success(res, 'Recurso creado exitosamente', result, 201);
  });
}

export default new MyController();
```

> ✅ `ApiResponse.success` detecta automáticamente si el resultado tiene `{ data, metadata }` y lo aplana.
> ❌ No desestructurar `{ data, metadata }` en el controller — pasar el resultado directo.
> ✅ `requireAuthUser(req)` (usuario autenticado tipado, o 401), `routeParam(req, 'id')` (string o 400) y
> `adminAuditContext(req, res)` (quién hace la acción admin): no leer `req.user` / `req.params` a mano.

## Service (con paginación)

```ts
import type { AdminAuditContext } from '../../../shared/application/audit-context';
import AppError from '../../../shared/presentation/http/app-error.util';
import { pageMetadata, pageRequest } from '../../../shared/application/pagination';
import type { MyListQuery } from '../requests/my.request';
import auditModule from '../../audit';
const { audit } = auditModule;
import unitOfWork from '../../../shared/infrastructure/database/unit-of-work';
import myRepository from '../repositories/my.repository';
import myResponse from '../responses/my.response';
const { MyListResponseDTO, MyDetailResponseDTO } = myResponse;

class MyService {
  unitOfWork: typeof unitOfWork;
  myRepository: typeof myRepository;

  // SOLID (D): dependencias por constructor, con la implementación real como default.
  constructor(deps: MyService.Deps = {}) {
    this.unitOfWork = deps.unitOfWork ?? unitOfWork;
    this.myRepository = deps.myRepository ?? myRepository;
  }

  // query: la ya validada por el esquema de la ruta (el controller la pasa con validQuery(req, MyListQuery))
  async list(query: MyListQuery, adminUserId: string) {
    const page = pageRequest(query); // page, limit, offset, sortBy, order
    const filters = { status: query.status ?? undefined, isActive: query.isActive ?? undefined };

    const { rows, count } = await this.myRepository.findAllPaginated(filters, page, query.search ?? null);

    await audit.record('MY_RESOURCE_LIST_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count, page: page.page },
      entityType: 'MyResource',
      entityTable: 'my_resources'
    });

    // la metadata informa el orden y los filtros aplicados (pageOf(data, page, count, filters) si el DTO es trivial)
    return MyListResponseDTO(rows, pageMetadata(page, count, { search: query.search, ...filters }));
  }

  async getById(id: string, adminUserId: string) {
    const record = await this.myRepository.findById(id);
    if (!record) {
      throw AppError.notFound('Recurso no encontrado');
    }
    await audit.record('MY_RESOURCE_VIEWED', { actorId: adminUserId, entityId: id, entityType: 'MyResource', entityTable: 'my_resources' });
    return MyDetailResponseDTO(record);
  }

  async create(payload: MyService.CreateInput, auditContext: AdminAuditContext) {
    // …
  }
}

// Tipos asociados: namespace con el mismo nombre que la clase (fusión de declaraciones)
// eslint-disable-next-line @typescript-eslint/no-namespace
namespace MyService {
  export interface Deps {
    unitOfWork?: typeof unitOfWork;
    myRepository?: typeof myRepository;
  }
  export interface CreateInput {
    name: string;
  }
}

// Instancia por defecto (controllers) + la clase (tests con fakes, composición)
export default Object.assign(new MyService(), { MyService });
```

> ✅ **SOLID** (ver [`solid.md`](solid.md)): repos vía `this.`, transacciones con `this.unitOfWork.run(async () => …)`
> (los repositorios toman la transacción solos), y **nunca** el cliente de Prisma en un service — si necesitas
> un filtro, crea un método con nombre de negocio en el repositorio (`findByNames`, `findActive`,
> `searchPaginated`…). Los tipos de las filas sí: `import type { User } from '…/generated/prisma/client'`.
> ✅ Si el service usa pocos métodos de un repositorio, declara el puerto con `Pick<XRepositoryPort, 'a' | 'b'>`
> (`src/modules/repository-ports.ts`).
> ✅ Listados: el contrato completo está en `src/shared/application/pagination.ts`. La query llega **ya validada y
> tipada** (`MyListQuery`): el service no vuelve a interpretar strings. La metadata sale **siempre** de
> `pageMetadata` / `pageOf`: `{ pagination, sort, filters? }`, con el orden y los filtros aplicados.
> ✅ El service retorna directamente el resultado del DTO (que tiene `{ data, metadata }`).
> ❌ No armar el objeto de metadata a mano ni repetir en él lo que pidió el cliente si no se aplicó.
> ❌ `export default new MyService()` sin la clase: la guarda de arquitectura lo rechaza (los tests no
> podrían inyectar dependencias).

## Respuesta (salida, Zod)

```ts
// responses/my.response.ts
import { z } from '../../../shared/presentation/validation/z';
import { dateTime } from '../../../shared/presentation/validation/output';
import type { PageMetadata } from '../../../shared/application/pagination';
import type { MyEntity } from '../../../shared/infrastructure/database/generated/prisma/client';

function MyItemDTO(row: MyEntity) {
  return { myEntityId: row.myEntityId, name: row.name, createdAt: row.createdAt }; // campo a campo
}

function MyListResponseDTO(rows: MyEntity[], metadata: PageMetadata) {
  return { data: Array.isArray(rows) ? rows.map(MyItemDTO) : [], metadata };
}

export const MyItemSchema = z.object({ myEntityId: z.uuid(), name: z.string(), createdAt: dateTime() });

export default { MyItemDTO, MyListResponseDTO };

// responses/my.response.test.ts — conformidad: la salida cumple su esquema
it('ítem', () => expect(MyItemSchema.safeParse(dto.MyItemDTO(fixture)).error?.issues ?? []).toEqual([]));
```

> ✅ Siempre `Array.isArray(rows) ? rows.map(...) : []`: nunca asumir que rows es array.
>
> ✅ **PII:** todo campo PII sale por `EncryptionUtil.safeDecrypt` + `MaskingUtil.maskXxx`, y los JSON
> propios por `MaskingUtil.redactPayload`. Campo nuevo → declararlo en `src/shared/domain/constants/pii-fields.ts`.
> Ver `docs/pii-masking.md` y `docs/dtos.md`.

## Repository

```ts
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../shared/application/pagination';
import type { MyEntity, Prisma } from '../../../shared/infrastructure/database/generated/prisma/client';

const SEARCH_FIELDS = ['name', 'description'] as const;

class MyRepository extends PrismaRepository {
  // `await this.db()`: el cliente de la transacción si hay un unitOfWork.run() activo, si no el único
  async findActiveByName(name: string): Promise<MyEntity | null> {
    return (await this.db()).myEntity.findFirst({ where: { name, isActive: true } });
  }

  async findAllPaginated(
    filters: PrismaRepository.Filters = {},
    page: PageRequest,
    searchTerm: string | null = null
  ): Promise<{ rows: MyEntity[]; count: number }> {
    const where: Prisma.MyEntityWhereInput = {
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...this.searchWhere(searchTerm, SEARCH_FIELDS)
    };
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.myEntity.findMany({ where, ...this.paginationArgs(page, 'myEntityId') }), // desempate por la PK
      db.myEntity.count({ where })
    ]);
    return { rows, count };
  }
}

export default new MyRepository();
```

> ✅ Extiende `PrismaRepository` y expone **solo** las operaciones que su tabla admite (una bitácora
> append-only no tiene `update`/`delete`) — SOLID: L/I.
> ✅ Repositorio nuevo → `node scripts/ts-migration/gen-repository-ports.js` (agrega su `XRepositoryPort`).
> ✅ Filtros, `include` y `select` viven aquí, detrás de métodos con nombre de negocio:
> `findByNames(names, { exclude })`, `findPaginatedWithDeviceAndUser(where, pagination)`. El service no
> arma `where` de Prisma.
> ✅ PII: se lee y escribe en claro (la extensión de `src/shared/infrastructure/database/prisma.ts` cifra y hashea); para buscar
> por un campo cifrado se filtra por su hash (`hashValue()` de `src/shared/infrastructure/database/pii-fields`).
> ✅ Escrituras que deben quedar aunque el flujo se revierta (bitácoras) → `this.independentDb()`.
> ✅ `paginationArgs(page, pk)` aplica el `sortBy` tal cual (ya lo validó el esquema del request) y desempata
> por la clave primaria: sin desempate, filas con el mismo valor pueden repetirse o faltar entre páginas.
> ✅ Los enums de dominio (estados, catálogos cerrados) se leen de `src/shared/infrastructure/database/domain-enums.ts`.

## Routes (admin)

```ts
import express from 'express';
import { validate } from '../../../shared/presentation/validation/validate';
import { MyListQuery } from '../requests/my.request';
const router = express.Router();
import MyController from '../controllers/my.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/presentation/http/request-lock.middleware';
import rbacModule from '../../../shared/domain/constants/rbac';
const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

router.get(
  '/',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.ADMIN, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  // DualApprovalMiddleware.require('OP_KEY', {...}),  ← SOLO en operaciones sensibles (write)
  validate({ query: MyListQuery }),
  MyController.list
);

export default router;
```

> ✅ En rutas admin siempre usar `RbacMiddleware.requirePermission(RBAC_MODULE, RBAC_ACTION)`.
> ✅ El módulo y la acción deben calzar semánticamente con lo que hace el endpoint.
> ❌ No usar `AuthMiddleware.requireRole` en rutas admin nuevas — usar RBAC.

## Request (entrada, Zod)

```ts
// requests/my.request.ts
import { z } from '../../../shared/presentation/validation/z';
import { input, optionalBool, optionalInList, pageQuery, searchQuery, text, uuid } from '../../../shared/presentation/validation/fields';

// Listado: por qué campos se ordena (pocos, con índice) y su orden por defecto; un sortBy fuera de la lista
// es un 422. Los filtros, tipados acá (el service no los vuelve a interpretar). z.object: lo no declarado
// se descarta. Orden fijo → `pagingQuery` (solo page/limit: no se acepta un sortBy que no se aplicaría).
export const MyListQuery = z.object({
  ...pageQuery(['createdAt', 'name'], { sortBy: 'createdAt' }),
  ...searchQuery,
  status: optionalInList(['draft', 'published'], { message: 'status inválido', hint: 'Indicá draft o published' }),
  isActive: optionalBool('El estado')
});
export type MyListQuery = z.output<typeof MyListQuery>; // lo que recibe el service
export const MyIdParams = input({ categoryId: uuid('La categoría') });

// z.object descarta lo que no está declarado (lista blanca)
export const CreateMyBody = z.object({ name: text('El nombre', { max: 120 }) });
export type CreateMyBody = z.infer<typeof CreateMyBody>; // lo que recibe el service

// en la ruta: validate({ params: MyIdParams, body: CreateMyBody })
```

## Modelo y migración

No hay modelos en el código: la tabla se declara en `prisma/schema.prisma` (el cliente y sus tipos se
generan con `npm run prisma:generate`, que corre solo antes de `dev`, `build`, `typecheck` y `test`) y la
migración la genera Prisma (detalle en
[`database.md`](database.md#cambiar-el-esquema)):

```prisma
model MyEntity {
  myId      String   @id(map: "pk_my_table") @default(uuid()) @map("my_id") @db.Uuid
  name      String   @db.VarChar(100)
  otherId   String   @map("other_id") @db.Uuid
  other     Other    @relation(fields: [otherId], references: [otherId], map: "fk_my_table_other_id")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([otherId], map: "idx_my_table_other_id")
  @@map("my_table")
}
```

```bash
npm run db:migrate:dev -- --name create-my-table   # genera prisma/migrations/<ts>_create-my-table/migration.sql
```

> ✅ Revisá el `migration.sql` generado antes de commitearlo; triggers, CHECK y comentarios se agregan a mano
> en ese archivo. Los datos base van en el seed (`prisma/seeds/`, `npm run db:seed`).
