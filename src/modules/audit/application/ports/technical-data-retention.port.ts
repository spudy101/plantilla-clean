// Puerto: la retención de datos técnicos de alto volumen y vida corta (no son auditoría): la traza de
// operaciones y las claves de idempotencia vencidas. Lo implementa
// infrastructure/persistence/prisma-technical-data.retention.ts.
export interface TechnicalDataRetention {
  /** Borra las operaciones que empezaron antes de `cutoff`; devuelve cuántas. */
  purgeOperationsBefore(cutoff: Date): Promise<number>;
  /** Borra las claves de idempotencia vencidas; devuelve cuántas. */
  purgeExpiredIdempotencyKeys(): Promise<number>;
}
