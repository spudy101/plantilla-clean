// Salidas del MFA (TOTP y SMS).
/**
 * ============================================================
 * MFA DTOs — CLIENT
 * ============================================================
 * DTOs simples — no usan componentes del shared porque
 * no mapean directamente a entidades de BD.
 */

/** Campos que exponen las respuestas de MFA. */
interface MfaFields {
  userId: string;
  username: string | null;
  otpauthUrl: string;
  secretCode: string;
  valid: boolean;
  totpEnabled: boolean;
  smsMfaEnabled: boolean;
  preferredMfaMethod: string;
  verificationCodeId: string;
  expiresAt: Date;
  truncatedCode: string | null;
}

function TOTPSetupResponseDTO({ otpauthUrl, secretCode, username }: Pick<MfaFields, 'otpauthUrl' | 'secretCode' | 'username'>) {
  return {
    otpauthUrl,
    secretCode,
    username,
    instructions:
      'Escanea el código QR con tu aplicación de autenticación ' +
      '(Google Authenticator, Authy, etc.) y verifica el código generado para activar TOTP.'
  };
}

function TOTPActivationResponseDTO({ userId, username, totpEnabled }: Pick<MfaFields, 'userId' | 'username' | 'totpEnabled'>) {
  return { userId, username, totpEnabled };
}

function TOTPVerificationResponseDTO({ valid, username }: Pick<MfaFields, 'valid' | 'username'>) {
  return { valid, username };
}

function PasswordValidationResponseDTO({ valid, username }: Pick<MfaFields, 'valid' | 'username'>) {
  return { valid, username };
}

function SMSMFAActivationResponseDTO({
  userId,
  username,
  smsMfaEnabled
}: Pick<MfaFields, 'userId' | 'username' | 'smsMfaEnabled'>) {
  return { userId, username, smsMfaEnabled };
}

function PreferredMethodResponseDTO({
  userId,
  username,
  preferredMfaMethod
}: Pick<MfaFields, 'userId' | 'username' | 'preferredMfaMethod'>) {
  return { userId, username, preferredMfaMethod };
}

function MFAStatusResponseDTO({
  userId,
  username,
  totpEnabled,
  smsMfaEnabled,
  preferredMfaMethod
}: Pick<MfaFields, 'userId' | 'username' | 'totpEnabled' | 'smsMfaEnabled' | 'preferredMfaMethod'>) {
  return { userId, username, totpEnabled, smsMfaEnabled, preferredMfaMethod };
}

function SMSActivationRequestResponseDTO({
  verificationCodeId,
  expiresAt,
  truncatedCode
}: Pick<MfaFields, 'verificationCodeId' | 'expiresAt' | 'truncatedCode'>) {
  return { verificationCodeId, expiresAt, truncatedCode };
}

export default {
  TOTPSetupResponseDTO,
  TOTPActivationResponseDTO,
  TOTPVerificationResponseDTO,
  PasswordValidationResponseDTO,
  SMSMFAActivationResponseDTO,
  SMSActivationRequestResponseDTO,
  MFAStatusResponseDTO,
  PreferredMethodResponseDTO
};

