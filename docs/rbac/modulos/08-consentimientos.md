# 🛡️ Consentimientos

> **Grupo RBAC:** `consents` · **Prefijo omitido:** `/admin/api/v1`
> Parte del mapeo de módulos del hub admin. Ver [README](README.md).

## La idea

Config legal: las **definiciones** de consentimientos y políticas de privacidad. La **aceptación
por-cliente** (evidencia de qué firmó cada persona) NO vive aquí — vive en
[Personas → Aceptación de Políticas](01-personas-clientes.md) (`policyAcceptance`). Split limpio:
config (definiciones) vs operación (evidencia per-cliente).

**Estructura:**
```
🛡️ Consentimientos  (grupo — config legal)
├─ Tipos de Consentimientos  → consentTypes
└─ Políticas de Privacidad   → privacyPolicies
```

---

## Tipos de Consentimientos — `RBAC: consentTypes`
```
GET    /records/legal/consent-types[/:consentTypeId]
POST   /records/legal/consent-types                        (create)
PATCH  /records/legal/consent-types/:consentTypeId         (update)
```

## Políticas de Privacidad — `RBAC: privacyPolicies`
```
GET    /records/legal/privacy-policies[/:privacyPolicyId]
POST   /records/legal/privacy-policies                     (create)
```

*Quién:* GOBIERNO_DATOS y OFICIAL_CUMPLIMIENTO (CONSENT all), CUMPLIMIENTO / DEFENSOR_CF (read).

---

## Decisiones del módulo

| # | Acción | Detalle | Estado |
|---|--------|---------|--------|
| 1 | Config legal (2 ítems) | Definiciones de tipos + políticas de privacidad. | ✅ |
| 2 | Aceptación per-cliente | Ya vive en [Personas](01-personas-clientes.md) (`policyAcceptance`), no aquí. | ✅ |
