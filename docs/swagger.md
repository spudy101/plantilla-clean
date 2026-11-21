# Swagger / OpenAPI — guía de onboarding

> Detalle aquí. El Swagger es el **paso 5 del cierre de un cambio**
> y va en el mismo pase que el código — no se aplaza a "cuando esté probado".

## Estructura

```
config/
  swagger.admin.ts     ← ensambla el spec del servidor ADMIN (requiere + spread de paths/schemas)
  swagger.client.ts    ← idem para CLIENT
  swagger/
    schemas/           ← schemas globales compartidos, GENERADOS desde los módulos (nada a mano)
    responses/common.responses.ts  ← helpers de respuestas estándar (ok, paginated, created, accepted, errores)
src/modules/<dominio>/docs/<recurso>.paths.ts
                       ← paths + schemas de cada recurso, junto a su módulo
```

Cada `*.paths.ts` exporta `{ paths, schemas, tags? }`. `swagger.admin.ts`/`swagger.client.ts` hacen
`require(...)` y spread: `allPaths = { ...modPaths.paths }`, `allModuleSchemas = { ...modPaths.schemas }`,
y `components.schemas = { ...getAllSchemas, ...allModuleSchemas }` (los globales + los de módulo conviven en
el mismo namespace, así que un `$ref` resuelve entre módulos).

## `common.responses.ts` (helpers)

- Éxitos (funciones): `ok(dataSchema, desc)` (200), `paginated(itemSchema, desc)` (200 con `Metadata`),
  `created(dataSchema, desc)` (201), `accepted(dataSchema, desc)` (202) y `noContent` (objeto para spread, 204).
- Errores (objetos para spread): `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`,
  `ValidationError` (422), `RateLimitExceeded` (429), `InternalServerError` (500), `ServiceUnavailable` (503).

```ts
import commonResponses from '../../../responses/common.responses';
responses: {
  200: commonResponses.ok({ $ref: '#/components/schemas/MiRecurso' }, 'Obtenido exitosamente'),
  ...commonResponses.Unauthorized,
  ...commonResponses.NotFound,
  ...commonResponses.InternalServerError
}
```

## Anatomía de un `*.paths.ts`

Los schemas, parámetros y bodies **no se escriben a mano**: salen de los esquemas Zod de `requests/` (entrada)
y `responses/` (salida) del módulo, con los helpers de `shared/validation/openapi.ts`:

- `toOpenApi(Schema)` → schema de un request; `toOpenApi(Schema, 'output')` → schema de una respuesta.
- `toParameters(Schema, 'query' | 'path' | 'header')` → la lista de `parameters` de la operación.
- `jsonBody('NombreDelSchema')` → `requestBody` JSON que apunta a `#/components/schemas/NombreDelSchema`.
- `multipartBody(CamposSchema, { archivo: 'descripción' })` → `requestBody` multipart con archivos.

```ts
import commonResponses from '../../../config/swagger/responses/common.responses';
import { jsonBody, toOpenApi, toParameters } from '../../../shared/validation/openapi';
import { MiRecursoIdParams, MiRecursoListQuery, UpdateMiRecursoBody } from '../requests/mi-recurso.request';
import { MiRecursoSchema } from '../responses/mi-recurso.response';

const schemas = {
  MiRecurso: toOpenApi(MiRecursoSchema, 'output'),
  MiRecursoUpdateRequest: toOpenApi(UpdateMiRecursoBody)
};

const paths = {
  '/admin/api/v1/{dominio}/mi-recurso': {
    get: {
      tags: ['Admin - Mi Recurso'],
      summary: '...',
      security: [{ bearerAuth: [], idTokenAuth: [] }],
      parameters: toParameters(MiRecursoListQuery, 'query'),
      responses: { 200: commonResponses.paginated({ $ref: '#/components/schemas/MiRecurso' }), ...commonResponses.Unauthorized }
    }
  },
  '/admin/api/v1/{dominio}/mi-recurso/{miRecursoId}': {
    patch: {
      tags: ['Admin - Mi Recurso'],
      summary: '...',
      parameters: toParameters(MiRecursoIdParams, 'path'),
      requestBody: jsonBody('MiRecursoUpdateRequest'),
      responses: { 200: commonResponses.ok({ $ref: '#/components/schemas/MiRecurso' }), ...commonResponses.ValidationError }
    }
  }
};

export default { schemas, paths };
```

Lo que sí se escribe a mano: `summary`, `description`, `tags`, `security` y qué `responses` aplican. Las
descripciones y ejemplos de cada campo van en el esquema Zod con `.meta({ description, example })`, y la pista
de validación (`withHint`) sale como `x-hint`.

## Registrar un módulo nuevo en el ensamblador

En `src/config/swagger.admin.ts` (o `swagger.client.ts`):

1. `import miRecursoPaths from '../modules/{dominio}/docs/mi-recurso.paths';`
2. Agregar `...miRecursoPaths.paths` al objeto `allPaths`.
3. Agregar `...miRecursoPaths.schemas` al objeto `allModuleSchemas`.

- Los `tags` se agrupan solos en Swagger UI por el `tags: [...]` de cada operación (no hay merge global de tags).
- Si un schema debe estar disponible en admin **y** client, generarlo en `swagger/schemas/` (por ejemplo
  `core.schema.ts`: `PendingApproval: toOpenApi(PendingApprovalSchema, 'output')`), que cargan ambos specs.
  Definirlo solo en un `*.paths.ts` admin y referenciarlo desde un path client deja el `$ref` colgando.

## Convención de rutas

Los paths se escriben con la ruta completa tal como queda montada en el monolito:
`/{server}/api/v1/{dominio}/{subdominio}/{recurso}` (ej. `/admin/api/v1/kyc/person`),
donde `{server}` ∈ `admin | client` (las rutas compartidas se documentan en ambos specs)
y `{dominio}` ∈ `kyc | records | notification | core | integration | auth`.
Excepción: `core`, `notification`, `integration` y `auth` no llevan `{subdominio}` (ej. `/admin/api/v1/core/approval-requests`).
Al agregar uno nuevo, seguir el patrón del módulo hermano más cercano.

## Checklist de revisión

1. **Request**: `parameters` y `requestBody` salen de los esquemas que usa `validate(...)` en la ruta, no de
   una copia.
2. **Response**: el `$ref` apunta a un schema generado desde el esquema de `responses/`, y ese esquema tiene su
   prueba de conformidad (`*.response.test.ts`).
3. **Todas las keys camelCase** (excepto valores de enum de BD).
4. **Status codes**: documentar 200/201/202, 400, 401, 403, 404, 409, 422, 500 cuando apliquen, con el código
   que de verdad devuelve el service (`AppError.badRequest` es 400, no 409).
5. **PII enmascarada**: en el esquema de **salida**, los campos con documento, correo, teléfono, TIN o cuenta llevan
   la `description` de `shared/validation/pii-masking.doc.ts` y un `example` enmascarado. ⚠️ **Nunca en los
   requests**: la entrada va completa. Ver `docs/pii-masking.md`.

## Validar el spec sin levantar el server

`tests/unit/guards/swagger-spec.test.ts` arma los dos specs y falla si algún `$ref` apunta a un schema que no
existe. Corre con `npm test`; no hace falta levantar el servidor.
