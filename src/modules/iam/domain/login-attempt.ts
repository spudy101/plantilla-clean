// Intentos de login (user_login_attempts): la constancia forense de cada intento, exitoso o no. El documento lo
// cifra quien lo guarda; el bloqueo de la cuenta en BD es el respaldo de Redis.
export interface LoginAttempt {
  userId?: string | null;
  usernameAttempt: string;
  /** En claro: lo cifra quien lo guarda (y calcula su hash de búsqueda). */
  nationalId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  success: boolean;
  failureReason?: string | null;
  blockedUntil?: Date | null;
  /** Explícito en los exitosos: las rutas de login son públicas y el contexto no trae la sesión recién creada. */
  originSessionId?: string | null;
}

export interface AccountBlock {
  blocked: true;
  blockedUntil: Date;
  remainingMinutes: number;
}
