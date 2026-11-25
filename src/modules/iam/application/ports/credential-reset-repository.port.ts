// Puertos: los tokens de reset de contraseña / MFA (tabla credential_resets) y los intentos de login
// (user_login_attempts).
import type { CredentialResetWithUser, ResetType } from '../../domain/credential-reset';
import type { AccountBlock, LoginAttempt } from '../../domain/login-attempt';

export interface CredentialResetRepository {
  /** Vigente y sin usar, con su titular. */
  findValidWithUser(token: string): Promise<CredentialResetWithUser | null>;
  /** Lo marca usado si seguía sin usar: false = otro request lo consumió primero. */
  markAsUsed(credentialResetId: string): Promise<boolean>;
  /** Invalida los vigentes del usuario; devuelve cuántos. */
  invalidateUserTokens(userId: string): Promise<number>;
  create(reset: { userId: string; token: string; email: string; type: ResetType; expiresAt: Date }): Promise<void>;
}

export interface LoginAttemptRepository {
  record(attempt: LoginAttempt): Promise<void>;
  /** El bloqueo vigente de la cuenta según el último intento (respaldo de Redis), o null. */
  findBlock(nationalId: string): Promise<AccountBlock | null>;
}
