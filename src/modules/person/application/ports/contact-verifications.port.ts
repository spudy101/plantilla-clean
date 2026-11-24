// Puerto: los códigos OTP con los que el titular confirmó un email o un teléfono (son de notification).
export type ContactKind = 'email' | 'phone';

export interface ContactVerifications {
  /** Si ese email o teléfono tiene un código ya confirmado. */
  isVerified(kind: ContactKind, value: string): Promise<boolean>;
  /** Borra los códigos confirmados de ese email o teléfono (ya se usaron). */
  consume(kind: ContactKind, value: string): Promise<void>;
}
