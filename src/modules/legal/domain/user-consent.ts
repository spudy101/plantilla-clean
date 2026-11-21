// Entidad: un consentimiento otorgado por un usuario (RF-ADM-04). Es un registro histórico: al otorgar de
// nuevo, el anterior deja de estar vigente (isCurrent=false) pero no se borra; al revocar se guarda cuándo
// y por qué.
//
// Según la consulta, trae una referencia al tipo, a la política aceptada y al titular.

/** Referencia al tipo de consentimiento (lo que trae la consulta; isActive y scope no siempre vienen). */
export interface ConsentTypeRef {
  consentTypeId: string;
  code: string;
  name?: string;
  isMandatory?: boolean;
  isRevocable?: boolean;
  isActive?: boolean;
  scope?: string;
}

/** Referencia a la versión de la política aceptada. */
export interface PrivacyPolicyRef {
  privacyPolicyId: string;
  version: string;
  documentUrl: string;
  effectiveDate: Date;
}

/** El titular del consentimiento. */
export interface ConsentHolder {
  userId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface UserConsentProps {
  userConsentId: string;
  userId: string;
  consentTypeId: string;
  privacyPolicyId: string | null;
  grantedAt: Date;
  grantedIp: string | null;
  revokedAt: Date | null;
  revocationReason: string | null;
  isCurrent: boolean;
  /** Sesión en que se otorgó (trazabilidad hacia user_sessions / audit_logs). */
  originSessionId: string | null;
  createdAt: Date;
  consentType?: ConsentTypeRef;
  privacyPolicy?: PrivacyPolicyRef | null;
  holder?: ConsentHolder;
}

/** Lo necesario para otorgar un consentimiento. */
export interface ConsentGrant {
  userId: string;
  consentTypeId: string;
  privacyPolicyId: string | null;
  ip: string | null;
  userAgent: string | null;
}

/** Lo necesario para revocar el consentimiento vigente de un usuario para un tipo. */
export interface ConsentRevocation {
  userId: string;
  consentTypeId: string;
  ip: string | null;
  reason: string | null;
}

export class UserConsent implements UserConsentProps {
  declare readonly userConsentId: string;
  declare readonly userId: string;
  declare readonly consentTypeId: string;
  declare readonly privacyPolicyId: string | null;
  declare readonly grantedAt: Date;
  declare readonly grantedIp: string | null;
  declare readonly revokedAt: Date | null;
  declare readonly revocationReason: string | null;
  declare readonly isCurrent: boolean;
  declare readonly originSessionId: string | null;
  declare readonly createdAt: Date;
  declare readonly consentType?: ConsentTypeRef;
  declare readonly privacyPolicy?: PrivacyPolicyRef | null;
  declare readonly holder?: ConsentHolder;

  private constructor(props: UserConsentProps) {
    Object.assign(this, props);
  }

  static restore(props: UserConsentProps): UserConsent {
    return new UserConsent(props);
  }

  /** Vale como consentimiento: no fue revocado. */
  isInForce(): boolean {
    return !this.revokedAt;
  }
}

/** Nombre para mostrar del titular ("Ana Pérez"); null si no tiene nombre cargado. */
export function holderFullName(holder: ConsentHolder): string | null {
  return [holder.firstName, holder.lastName].filter(Boolean).join(' ') || null;
}
