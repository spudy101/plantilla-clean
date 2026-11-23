// Puerto: cómo traer y mostrar las filas de una tabla de dominio tocadas en una sesión (consentimientos,
// preferencias de notificación, dispositivos…). Las tablas son de otros módulos: src/main/adapters arma el
// registro (tabla → fuente) y se lo pasa a audit. Agregar una tabla a la traza = agregar una fuente ahí.
//
// PII: esta vista NO es self-view. Una fuente con datos sensibles los enmascara u omite.

export interface TracedEntitySource {
  entityType: string;
  /** Las filas con esos ids, ya en su forma de salida. */
  findByIds(ids: string[]): Promise<unknown[]>;
}

/** entity_table → fuente. */
export type TracedEntityRegistry = Readonly<Record<string, TracedEntitySource>>;
