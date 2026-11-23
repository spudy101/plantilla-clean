// Traza forense de una sesión: qué se hizo en ella (sus registros de auditoría) y con qué filas de dominio.
//
// La fuente es audit_logs (session_id + entity_table/entity_id), no un recorrido por todas las tablas. Las
// filas se hidratan por lote, una consulta por tabla, y solo para las tablas que alguien sabe mostrar (las
// demás quedan en `skipped`).

/** Una fila de dominio tocada en la sesión. */
export interface EntityRef {
  entityTable: string;
  entityId: string;
}

/** Ids únicos por tabla, en el orden en que aparecen; `onlyTable` acota a una sola tabla. */
export function idsByTable(refs: EntityRef[], onlyTable: string | null): Map<string, string[]> {
  const grouped = new Map<string, Set<string>>();
  for (const ref of refs) {
    if (onlyTable && ref.entityTable !== onlyTable) {
      continue;
    }
    if (!grouped.has(ref.entityTable)) {
      grouped.set(ref.entityTable, new Set());
    }
    grouped.get(ref.entityTable)!.add(ref.entityId);
  }
  return new Map([...grouped].map(([table, ids]) => [table, [...ids]]));
}

/** Un evento del timeline tiene detalle si su tabla se sabe mostrar y apunta a una fila puntual. */
export function hasDetail(log: { entityTable: string | null; entityId: string | null }, hydratableTables: ReadonlySet<string>): boolean {
  return Boolean(log.entityTable && log.entityId && hydratableTables.has(log.entityTable));
}
