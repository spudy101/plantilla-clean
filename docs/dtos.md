# Respuestas (`responses/`) — guía de onboarding

> Resumen en `docs/ARCHITECTURE.md` ("Entrada y salida"). PII/descifrado: `docs/encryption-pii.md`.
> **Enmascaramiento de PII en la respuesta: `docs/pii-masking.md`.**

Cada módulo arma lo que devuelve la API en `src/modules/<dominio>/responses/`. Cada archivo tiene dos cosas:

1. **la función que arma la salida** desde las filas de Prisma (`XxxDTO(...)` o `XxxComponent.build(...)`), y
2. **su esquema Zod de salida** (`XxxSchema`), al final del archivo, que tipa y documenta esa salida.

Una prueba de conformidad (`*.response.test.ts`) corre cada función sobre un ejemplo y exige que cumpla su
esquema. Si agregás un campo a la salida y no al esquema (o al revés), falla, y Swagger no se desalinea.

## Reglas base

- Nunca `{ ...row }`: mapear campo a campo (una fila puede traer columnas internas: hashes, secretos).
- Todas las keys del JSON de respuesta en **camelCase** (excepción: valores de enum de BD, ver abajo).
- Los `*_hash` nunca se incluyen.
- **PII siempre `safeDecrypt` + máscara** (`MaskingUtil`); los JSON propios, por `redactPayload`. Ver `pii-masking.md`.
- Una pieza que usan varias respuestas se arma **una sola vez** en el `*-components.response.ts` del módulo
  dueño; las demás respuestas delegan en ella. Otro módulo la usa a través del `index.ts` del dueño.

```ts
// ✅ delega en el componente
const ConsentTypeListDTO = (record: ConsentTypeRow) => ConsentTypeComponent.buildList(record);

// ❌ mapeo duplicado
const ConsentTypeListDTO = (record: ConsentTypeRow) => ({ id: record.consentTypeId, name: record.name });
```

## ¿Función DTO o solo esquema?

> **Esquema siempre. Función DTO solo cuando mapeás una fila de la base o hay datos personales.**

La función existe para elegir campo a campo qué sale de una fila (que no se filtren hashes ni columnas internas) y
para enmascarar PII. Si el caso de uso devuelve una confirmación armada a mano (`{ sessionId, status }`,
`{ closedCount }`, `{ userId, deleted: true }`), no hay nada que filtrar: una función `XxxDTO()` solo agregaría una
vuelta. Ahí basta con el tipo de salida en `application/dto/` (el caso de uso no conoce la presentación) y su esquema
en `responses/`, que la prueba de conformidad mantiene alineados:

```ts
// application/dto/auth-login.output.ts
export interface SessionClosed { sessionId: string; status: 'closed' }

// application/use-cases/sessions.ts (SessionControl)
return { sessionId, status: 'closed' } satisfies SessionClosed;

// presentation/http/responses/auth-login.response.ts (describe la salida y Swagger)
export const SessionClosedSchema = z.object({ sessionId: z.uuid(), status: z.literal('closed') });
```

`satisfies` hace que TypeScript falle si el caso de uso se aparta de su tipo, la prueba de conformidad
(`*.response.test.ts`) falla si el esquema se aparta de lo que devuelve, y la documentación sale del esquema.

## Componentes

```ts
class XyzComponent {
  static build(record: Maybe<XyzRow>) {
    if (!record) return null; // guarda defensiva
    return { xyzId: record.xyzId, name: record.name, createdAt: record.createdAt }; // campo a campo
  }
  static buildArray(rows: Maybe<XyzRow[]>) {
    return Array.isArray(rows) ? rows.map(r => XyzComponent.build(r)) : [];
  }
  // buildList (ítem liviano de lista) / buildDetail (con relaciones) según el dominio
}
```

Las opciones de `build` (`{ includeRole: true, includeContact: true }`) se agregan solo cuando hay un llamador
real que las usa; los campos que aparecen según una opción van `.optional()` en el esquema.

## Esquemas de salida

```ts
import { z } from '../../../shared/presentation/validation/z';
import { dateTime, listOf } from '../../../shared/presentation/validation/output';
import piiMaskingDoc from '../../../shared/presentation/validation/pii-masking.doc';

export const XyzSchema = z.object({
  xyzId: z.uuid(),
  name: z.string().meta({ example: 'Ejemplo' }),
  email: z.string().nullable().meta({ example: '****n@example.com', description: piiMaskingDoc.MASKED_EMAIL_DESC }),
  createdAt: dateTime() // Date en el código, string ISO en el JSON
});
```

- Lo que puede venir `null` lleva `.nullable()`; lo que puede no venir, `.optional()`.
- `description` y `example` van en `.meta({...})` y salen tal cual en Swagger.
- Si otro módulo necesita tu esquema, exponelo en tu `index.ts` (ver `personModule.personSchemas`).

La prueba de conformidad sigue siempre la misma forma:

```ts
const ok = (schema, value) => expect(schema.safeParse(value).error?.issues ?? []).toEqual([]);
it('xyz', () => ok(XyzSchema, components.XyzComponent.build(fixture)));
```

## Lista paginada

```ts
function ListXyzResponseDTO(rows: XyzRow[], metadata: PageMetadata) {
  return { data: Array.isArray(rows) ? rows.map(r => XyzComponent.build(r)) : [], metadata };
}
```

El service arma `metadata` con `pageMetadata(page, total, filtros)` (`src/shared/application/pagination.ts`: `{ pagination, sort, filters? }`, con el orden y los filtros **aplicados**) y se lo pasa al DTO; nunca se arma a mano. En
Swagger se documenta con `commonResponses.paginated({ $ref: '#/components/schemas/Xyz' })`.

## Excepción de snake_case: valores de enum

Las **keys** siempre camelCase, pero los **valores** de enum/estado de BD se mantienen en snake_case
(`partial_failure`, `pending_second_approval`, …), tanto como valor de un campo como cuando son claves dinámicas
de estadísticas. No aplicar conversión sobre esos valores.

> Un JSON propio (`metadata`, `details`, etc.) no se asigna crudo a la salida: pasa por `redactPayload`
> (enmascara PII) y, si el front espera camelCase, se normaliza campo a campo.
