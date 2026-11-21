# Encriptación y PII — guía de onboarding

> Detalle aquí.
> Utils: `src/shared/security/encryption.util.ts` (AES-256-GCM) y `src/shared/security/hash.util.ts` (HMAC para búsqueda).
>
> Este doc cubre cómo se **guarda** la PII. Cómo **sale** por la API (enmascaramiento en respuestas) está en
> [`pii-masking.md`](./pii-masking.md).

## Idea general

Los campos PII se guardan **cifrados** (AES-256-GCM) y, en paralelo, se guarda un **hash determinístico**
(`*_hash`, HMAC-SHA256) que permite buscar por igualdad sin descifrar. El cliente de Prisma lo hace
solo (`piiExtension`, `src/src/shared/database/prisma-extensions.ts`): descifra al leer —también en `include`— y
cifra + calcula el hash al escribir —también en escrituras anidadas—. Los repositorios leen y escriben en claro.
Los `*_hash` son internos: **nunca** se exponen en DTOs.

## Campos cifrados

| Modelo de Prisma     | Campo cifrado                                       | Hash gemelo          |
| -------------------- | --------------------------------------------------- | -------------------- |
| `Person`             | `nationalId`                                        | `nationalIdHash`     |
| `PersonContact`      | `email`, `phonePrimary`, `phoneSecondary`           | `*Hash` de cada uno  |
| `UserTrustedDevice`  | `hmacSecret`                                        | —                    |

> La tabla sale de `ENCRYPTED_FIELDS` (`src/shared/database/pii-fields.ts`): una sola declaración.
>
> `UserLoginAttempt.nationalIdHash` es un caso de **solo hash**: guarda el HMAC para correlacionar intentos
> sin persistir nunca el documento.
>
> `HashUtil` lee `process.env.HASH_PEPPER` directamente (`src/shared/security/hash.util.ts`) — única excepción viva a
> la regla `no-process-env` fuera de `src/shared/constants/`.

## `EncryptionUtil` (`src/shared/security/encryption.util.ts`)

- `encrypt(data)` → `"${ivHex}:${authTagHex}:${ciphertextHex}"` (IV aleatorio de 12 bytes por operación;
  salida autocontenida). AES-256-GCM (AEAD, integridad verificada).
- `decrypt(data)` → detecta formato nuevo (GCM, 3 partes) o legado (CBC). Lanza si el authTag no valida.
- `safeDecrypt(value)` → descifra y, si falla, devuelve el valor original. Lo usa la extensión al leer
  (un dato legado guardado en claro se devuelve tal cual) y los DTOs como defensa.
- `generateHmac(data, secret)` → HMAC-SHA256 genérico. **La firma de requests mobile NO usa este**: usa
  `generateRequestHmac(timestamp, method, path, secret)` sobre `${timestamp}:${method}:${path}`, con ventana
  de 10 s (`src/shared/security/hmac.service.ts`).
- Clave AES desde config (env). El `AES_IV` del env es solo compatibilidad legado (CBC); los cifrados
  nuevos usan IV aleatorio embebido.

## `HashUtil` (`src/shared/security/hash.util.ts`) — búsqueda determinística

- `hashForSearch(value)` → HMAC-SHA256 de `value.trim().toLowerCase()` con `HASH_PEPPER` (secreto en env /
  Secrets Manager, mín. 32 chars). Determinístico → sirve para cláusulas `WHERE *_hash = ...`. Devuelve
  `null` si el valor es vacío.
- Es la pieza que resuelve el problema de "no se puede buscar por un campo con IV aleatorio".

> ⚠️ El `*_hash` NO es un HMAC con la clave AES; es `HashUtil.hashForSearch` con `HASH_PEPPER`. Sin
> `HASH_PEPPER` configurado, el server no debe arrancar.

## La extensión de Prisma (`piiExtension`)

```ts
// src/shared/database/pii-fields.ts — qué se cifra (una sola declaración)
export const ENCRYPTED_FIELDS = {
  Person: [{ field: 'nationalId', hash: 'nationalIdHash' }],
  PersonContact: [{ field: 'email', hash: 'emailHash' }, { field: 'phonePrimary', hash: 'phonePrimaryHash' }, …],
  UserTrustedDevice: [{ field: 'hmacSecret' }]
};
```

- **Escritura** (`create`, `update`, `upsert`, `createMany`…, también anidadas): cifra el campo y calcula su
  hash. Actualizar el campo actualiza el hash.
- **Lectura** (también los `include`): descifra.
- **`where` sobre un campo cifrado lanza**: hay que filtrar por su hash.
- Un campo cifrado que sea **JSONB** (PII anidada) o que **no deba descifrarse en cada lectura** no se declara
  ahí: lo cifra y descifra su service/helper (`totpSecret`, códigos de verificación).

## Búsqueda por hash (repositorios)

```ts
import { hashValue } from '../../../../src/shared/database/pii-fields';

// person-contact.repository.ts
async findByEmail(email: string) {
  return (await this.db()).personContact.findFirst({ where: { emailHash: hashValue(email) } });
}
```

❌ Nunca `WHERE email = EncryptionUtil.encrypt(email)` (no determinístico, nunca haría match).
✅ Siempre buscar por el `*_hash`.

## Reglas

- ❌ Los `*_hash` nunca van en DTOs ni se envían al cliente — solo para `WHERE`.
- ✅ En DTOs, pasar el valor por `EncryptionUtil.safeDecrypt(...)` (defensa ante datos legados) y
  **enmascarar el resultado** antes de exponerlo
  (`MaskingUtil.maskDocumentId/maskEmail/maskPhone`). Ver [`pii-masking.md`](./pii-masking.md).
- ✅ Para nuevos campos PII: columna cifrada + columna `*_hash`, el campo en `ENCRYPTED_FIELDS`
  (o helper explícito si es JSONB/anidado), método `findByX` en el repo filtrando por `hashValue()`, y **la key
  del campo declarada en `src/shared/constants/pii-fields.ts`** para que quede enmascarado en las respuestas.
