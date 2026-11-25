// Puerto: el umbral configurado de una operación THRESHOLD (una columna de la configuración global, que es de
// settings). Lo implementa src/main/adapters/approval-sources.adapter.ts.

export interface ApprovalThresholds {
  /** El valor configurado bajo `configKey`; null si no hay (se usa el default de la operación). */
  read(configKey: string): Promise<number | null>;
}
