// Puerto: los consentimientos del titular (son de legal).

/** Un tipo de consentimiento del catálogo con el estado del titular en él (la forma la decide legal). */
export type ConsentCatalogItem = Record<string, unknown>;

export interface ProfileConsents {
  /** Todos los tipos activos, cada uno con si el titular lo otorgó. */
  catalogFor(userId: string): Promise<ConsentCatalogItem[]>;
  /** Revoca todos los consentimientos vigentes (cuenta eliminada). */
  revokeAll(userId: string): Promise<void>;
}
