// Suppression list de correo: una dirección que acumula rebotes duros deja de recibir envíos (protege la
// reputación de envío de SES). Se identifica por el hash SHA-256 del correo normalizado, nunca en claro.

/** Regla de negocio fija (no configurable): a los 3 rebotes duros la dirección se suprime. */
export const HARD_BOUNCE_SUPPRESSION_THRESHOLD = 3;

const SHA256_HEX = /^[a-f0-9]{64}$/i;

/** ¿Ya es un email_hash (hex de 64)? Así llega desde el listado admin. */
export const isEmailHash = (value: string): boolean => SHA256_HEX.test(value);

/** El correo como se hashea: sin espacios alrededor y en minúsculas. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Resultado de registrar un rebote duro. */
export interface HardBounceResult {
  bounceCount: number;
  /** La dirección quedó (o ya estaba) por encima del umbral. */
  suppressed: boolean;
  alreadySuppressed: boolean;
}

/** Solo la transición active → suppressed es un bloqueo nuevo (no cada rebote posterior). */
export const isNewSuppression = (result: HardBounceResult): boolean => result.suppressed && !result.alreadySuppressed;

export interface EmailSuppression {
  emailBounceSuppressionId: string;
  emailHash: string;
  userId: string | null;
  bounceCount: number;
  status: 'active' | 'suppressed';
  lastErrorCode: string | null;
  lastBounceAt: Date | null;
  suppressedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
