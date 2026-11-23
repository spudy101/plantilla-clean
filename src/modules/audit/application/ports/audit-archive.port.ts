// Puerto: la copia fría de la auditoría (S3, Standard-IA → Glacier por lifecycle). Lo implementa
// infrastructure/storage/s3-audit-archive.ts.
export interface AuditArchive {
  /** Sobrescribe la key si existe: re-exportar un día es seguro. */
  upload(key: string, jsonLines: string): Promise<void>;
}
