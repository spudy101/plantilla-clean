// Puerto: la copia en caché de la política vigente. La lee otro módulo (catalogs la muestra al público); legal
// solo necesita invalidarla cuando publica una versión nueva. src/main/ conecta las dos cosas
// (adapters/privacy-policy-cache.adapter.ts): legal no sabe qué clave ni qué caché usa catalogs.

export interface ActivePrivacyPolicyCache {
  invalidate(): Promise<void>;
}
