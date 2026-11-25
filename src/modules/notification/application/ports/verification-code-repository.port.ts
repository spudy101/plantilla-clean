// Puerto de persistencia de los códigos OTP. Lo implementa
// infrastructure/persistence/prisma-verification-code.repository.ts.
import type { VerificationCode, VerificationCodeType } from '../../domain/verification-code';

export interface NewVerificationCode {
  type: VerificationCodeType;
  contactValue: string;
  code: string;
  expiresAt: Date;
}

export interface VerificationCodeRepository {
  /** Último código vigente y sin verificar del contacto. */
  findActiveByContact(type: VerificationCodeType, contactValue: string): Promise<VerificationCode | null>;
  /** Segundos que faltan para poder pedir otro código (0 = ya se puede). */
  secondsUntilNewCode(type: VerificationCodeType, contactValue: string): Promise<number>;
  create(code: NewVerificationCode): Promise<VerificationCode>;
  /** Suma un intento si sigue vigente y sin verificar. */
  incrementAttempts(verificationCodeId: string): Promise<number>;
  markAsVerified(verificationCodeId: string): Promise<VerificationCode | null>;
  /** Borra los vencidos sin verificar; devuelve cuántos. */
  deleteExpired(): Promise<number>;
  /** Borra los verificados hace más de `retentionDays` días; devuelve cuántos. */
  deleteOldVerified(retentionDays: number): Promise<number>;
}
