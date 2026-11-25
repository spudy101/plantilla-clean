// Puerto de persistencia de los consentimientos otorgados. Lo implementa
// infrastructure/persistence/prisma-user-consent.repository.ts.
//
// Las consultas que devuelven consentimientos para mostrar traen el tipo y la política (y en la vista admin,
// el titular): el puerto lo promete para que el caso de uso no tenga que pedirlos aparte.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { ConsentGrant, ConsentRevocation, UserConsent } from '../../domain/user-consent';

export interface UserConsentPage {
  rows: UserConsent[];
  count: number;
}

export interface UserConsentAdminFilters {
  userId?: string;
  isCurrent?: boolean;
  dateFrom?: string | Date;
  dateTo?: string | Date;
  consentTypeCode?: string;
}

export interface UserConsentRepository {
  /** Los consentimientos vigentes del usuario, con tipo y política, del más reciente al más antiguo. */
  findCurrentByUser(userId: string): Promise<UserConsent[]>;

  findCurrentByUserAndType(userId: string, consentTypeId: string): Promise<UserConsent | null>;

  /** Todo el historial del usuario (vigentes y no), con tipo, política y titular. */
  listHistoryByUser(userId: string, page: PageRequest): Promise<UserConsentPage>;

  /** Listado admin con filtros, con tipo, política y titular. */
  listForAdmin(filters: UserConsentAdminFilters, page: PageRequest): Promise<UserConsentPage>;

  /**
   * Otorga un consentimiento: si había uno vigente del mismo tipo deja de estarlo y se crea el nuevo, de forma
   * atómica (dentro de la unidad de trabajo de quien llama, si hay una).
   */
  grant(grant: ConsentGrant): Promise<UserConsent>;

  /** Revoca el consentimiento vigente del usuario para el tipo; null si no había uno. */
  revokeCurrent(revocation: ConsentRevocation): Promise<UserConsent | null>;

  /** Por id (los que muestra la traza de una sesión de audit). */
  findByIds(ids: readonly string[]): Promise<UserConsent[]>;

  /** Derecho de supresión: revoca todos los vigentes del usuario; devuelve cuántos. */
  revokeAll(userId: string): Promise<number>;
}
