# Enmascaramiento PII en respuestas — guía de onboarding

> **Complementa** a [`encryption-pii.md`](./encryption-pii.md): ahí se explica cómo se guarda la PII
> (cifrada at-rest); aquí, cómo **sale** por la API.
> Piezas: `src/shared/domain/constants/pii-fields.ts` · `src/shared/infrastructure/security/masking.util.ts` ·
> `src/shared/infrastructure/security/pii-masking.middleware.ts`.

## Idea general

Se enmascara por defecto en **todas** las respuestas. Si un dato hace falta completo en alguna pantalla, se
quita la máscara ahí puntualmente (opt-out) — nunca al revés.

Los **identificadores** protegidos: documento, correo, teléfono, TIN y número de cuenta. La lógica vive en
`MaskingUtil` + el catálogo `pii-fields.ts`.

## 1. Qué se enmascara

| Dato                                          | Máscara            | Ejemplo             |
| --------------------------------------------- | ------------------ | ------------------- |
| Documento / cédula (`national_id`)            | últimos 4          | `******4050`        |
| Celular / teléfono (incl. `reference_phone`)  | últimos 4          | `******4567`        |
| Correo (personal, institucional, corporativo) | 1er char + dominio | `****n@gmail.com`   |
| TIN / `us_tin`                                | últimos 4          | `****6789`          |
| Número de cuenta                              | `****` + últimos 4 | `****7890`          |

**NO se enmascara** (decisión explícita, no olvido):

- Nombres y apellidos — rompería listados, colas de revisión y la búsqueda visual del admin.
- Direcciones físicas, código postal y fechas (nacimiento, etc.).
- IPs y user-agent de auditoría — son la **evidencia probatoria**; enmascararlas rompe la trazabilidad legal.
- `temporaryPassword` (credencial one-shot) y el `truncatedCode` del OTP (ya viene truncado).

Las máscaras son **idempotentes**: `maskDocumentId('******4050') === '******4050'`. Eso es lo que permite
tener dos capas encima sin degradar el valor.

## 2. Las tres capas

### Capa A — catálogo único: `src/shared/domain/constants/pii-fields.ts`

Un solo mapa `key normalizada → tipo de máscara`. La normalización quita separadores y baja a minúsculas,
así que `national_id`, `nationalId` y `NationalID` colapsan en `nationalid`.

**La comparación es exacta sobre la key normalizada, nunca por substring**: `email` se enmascara, pero
`emailVerifiedAt` e `isEmailVerified` no se tocan.

Hay un tipo especial `AUTO` para columnas polimórficas (`contactValue` de un OTP, `previousValue`/`newValue`
del diff de la bitácora de cambios (`USER_FIELD_CHANGED`)): decide por la **forma** del valor y deja intacto lo que no parece PII
(`activo`, `inactivo`). Las **fechas ISO** (`1995-03-12`) se reconocen ANTES que la forma de
teléfono/documento y pasan intactas (`ISO_DATE_SHAPE`, `masking.util.ts`) — coherente con la política de no
enmascarar fechas: `birth_date` sale legible en el diff de la bitácora de cambios.

`PII_RAW_PAYLOAD_KEYS` lista los subárboles que **no se recorren** (`rawData`, `rawRequest`, `rawResponse`,
`rawPayload`, `failureRequest`, `failureResponse`, `requestPayload`, `responsePayload`): las respuestas
crudas de terceros se dejan tal cual (ver §5).

> **Agregar un campo PII nuevo = agregar su key aquí.** Queda cubierto en las tres capas de una vez.

### Capa B — los DTOs (la que manda)

Cada DTO enmascara en origen. La extensión de Prisma ya entrega la PII descifrada, pero el DTO la pasa
igual por `safeDecrypt` (defensa ante datos legados o filas armadas a mano) y después enmascara:

```js
// ✅ patrón correcto en un DTO
nationalId: MaskingUtil.maskDocumentId(EncryptionUtil.safeDecrypt(person.national_id)) || null,
email: MaskingUtil.maskEmail(EncryptionUtil.safeDecrypt(contact.email)) || null
```

Los componentes compartidos (`PersonComponent`, `PersonContactComponent`, …) ya lo hacen. Para los JSONB
propios —`metadata` de notificaciones, `details` de `audit_logs`— se usa el redactor profundo:

```js
metadata: MaskingUtil.redactPayload(record.metadata) || null
```

`redactPayload` recorre objetos y arrays a cualquier profundidad, no muta el original, tiene tope de
profundidad y **solo entra en objetos planos** (una `Date` o una instancia de clase se devuelven intactas
para no romper su serialización).

### Capa C — red de seguridad en `ApiResponse.success()`

`src/shared/presentation/http/app-response.util.ts` es el embudo único de toda respuesta exitosa. Ahí se pasa `data` y
`metadata` por `PiiMaskingMiddleware.apply()`, que aplica `redactPayload` salvo que la ruta esté exenta.

Se enganchó ahí y **no como middleware global de `src/main/app.ts`** porque
cubre también cualquier DTO futuro que se olvide de enmascarar.

> La capa C es una **red**, no la solución. Si un DTO nuevo filtra PII, el bug está en el DTO: arréglalo ahí.

## 3. Rutas exentas (opt-out)

El único opt-out del template es el **registro**: el usuario está confirmando sus propios datos y necesita
verlos completos.

```js
// en el *.routes.ts, antes del validator
PiiMaskingMiddleware.allowUnmasked(),
```

| Ruta                                        | Por qué                                           |
| ------------------------------------------- | ------------------------------------------------- |
| `POST /client/api/v1/auth/register`         | el usuario confirma sus propios datos              |

Todo lo demás va enmascarado, **incluido el self-view** del cliente sobre su propio perfil y el login. Un
proyecto derivado que necesite mostrar un dato completo en otra pantalla agrega `allowUnmasked()` en esa
ruta y **documenta por qué**.

## 4. Payloads crudos de terceros (aplazado)

Los **payloads crudos devueltos por integraciones externas** no se enmascaran: se dejan tal cual los
devolvió el tercero, y `PII_RAW_PAYLOAD_KEYS` los excluye del recorrido. Solo se enmascara lo que
devolvemos nosotros desde nuestra BD. Tocarlos exige decidir antes qué necesita soporte técnico para
depurar una falla real.

## 5. Swagger

- Los textos compartidos viven en `src/shared/presentation/validation/pii-masking.doc.ts`:
  `MASKED_DOCUMENT_DESC`, `MASKED_PHONE_DESC`, `MASKED_EMAIL_DESC`, `MASKED_ACCOUNT_DESC`,
  `REDACTED_PAYLOAD_DESC`, `UNMASKED_ROUTE_DESC`.
- ⚠️ **Los `requestBody` y `parameters` NUNCA se documentan como enmascarados**: la entrada va siempre
  completa. Si un mismo `const` sirve a request y response, hay que partirlo en dos.

## 6. Checklist para un campo o feature nuevo

1. ¿El campo es documento, correo, teléfono, TIN o cuenta? → agrégalo a `PII_FIELD_MASKS` en `pii-fields.ts`.
2. En el DTO: `safeDecrypt` y después `MaskingUtil.maskXxx(...)`. Si es un JSONB propio, `redactPayload`.
3. ¿La respuesta lleva un JSONB de un tercero? → no lo toques; si su key no está en `PII_RAW_PAYLOAD_KEYS`,
   agrégala.
4. Swagger: `description` con la constante correspondiente y `example` enmascarado — **solo en la respuesta**.
5. ¿Necesitas el dato completo en una ruta? → `PiiMaskingMiddleware.allowUnmasked()` y **documenta por qué**.

## Reglas

- ❌ Nunca exponer el campo sin enmascarar: siempre `safeDecrypt` + `MaskingUtil`.
- ❌ Nunca enmascarar un `requestBody`, ni en el código ni en Swagger.
- ✅ El enmascaramiento se arregla **en el DTO**; la red de `ApiResponse` es respaldo, no excusa.
- ✅ Un campo PII nuevo se declara en `pii-fields.ts`, no se enmascara a mano en cada DTO.
