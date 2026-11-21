// Entidad: una versión publicada de la política de privacidad. Solo una está vigente (isActive) a la vez.
//
// TypeScript puro. La regla propia es dónde vive el PDF de cada versión: una ruta predecible a partir del
// número de versión, para que la URL pública sea estable.

export interface PrivacyPolicyProps {
  privacyPolicyId: string;
  /** Formato N.N (1.0, 1.1, 2.0). Única. */
  version: string;
  /** URL pública del PDF. */
  documentUrl: string;
  /** SHA-256 del PDF: prueba de qué texto exacto aceptó cada usuario. */
  documentHash: string | null;
  summary: string | null;
  isActive: boolean;
  effectiveDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Una versión nueva lista para publicar (el repositorio la deja como la única vigente). */
export interface NewPrivacyPolicyVersion {
  version: string;
  documentUrl: string;
  documentHash: string;
  summary: string | null;
  effectiveDate: Date;
}

export class PrivacyPolicy implements PrivacyPolicyProps {
  declare readonly privacyPolicyId: string;
  declare readonly version: string;
  declare readonly documentUrl: string;
  declare readonly documentHash: string | null;
  declare readonly summary: string | null;
  declare readonly isActive: boolean;
  declare readonly effectiveDate: Date;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  private constructor(props: PrivacyPolicyProps) {
    Object.assign(this, props);
  }

  static restore(props: PrivacyPolicyProps): PrivacyPolicy {
    return new PrivacyPolicy(props);
  }

  /**
   * Dónde se guarda el PDF de una versión: legal/privacy-policy-v1-1.pdf para la 1.1 (los puntos pasan a
   * guiones para que la URL sea segura). Predecible: la misma versión siempre en la misma ruta.
   */
  static documentKey(version: string): string {
    return `legal/privacy-policy-v${version.replaceAll('.', '-')}.pdf`;
  }
}
