// Puerto: dónde se publican los PDF de la política de privacidad. Lo implementa
// infrastructure/storage/s3-policy-document.storage.ts (bucket público + CloudFront).
//
// El caso de uso decide la ruta (regla del dominio: PrivacyPolicy.documentKey) y recibe la URL pública y la
// huella del contenido, sin saber que hay un bucket ni una CDN.

export interface PublishedPolicyDocument {
  /** URL pública y estable del PDF. */
  url: string;
  /** SHA-256 (hex) del contenido publicado. */
  sha256: string;
}

export interface PolicyDocumentStorage {
  /** Publica el PDF en `key`, reemplazando lo que hubiera, y lo deja visible de inmediato. */
  publish(key: string, content: Uint8Array): Promise<PublishedPolicyDocument>;
}
