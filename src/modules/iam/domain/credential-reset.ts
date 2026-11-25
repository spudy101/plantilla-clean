// Reset de credenciales (contraseña o MFA) por un enlace de un solo uso enviado al correo.
export type ResetType = 'password' | 'mfa';

export interface CredentialReset {
  credentialResetId: string;
  userId: string;
  token: string;
  email: string;
  type: ResetType;
  expiresAt: Date;
  used: boolean | null;
}

/** El token con su titular: id, authUsername, nombre y email. */
export interface CredentialResetWithUser extends CredentialReset {
  user: {
    userId: string;
    authUsername: string | null;
    person: { personId: string; firstName: string; contact: { email: string } | null } | null;
  };
}

/** Los dos factores que se registran en la bitácora al resetear el MFA. */
export const MFA_RESET_CHANGES = ['mfa_status', 'sms_mfa_status'] as const;

/** El enlace del correo: una ruta del front por tipo, con el token y el tipo en la query. */
export function resetLink(baseUrl: string | undefined, type: ResetType, token: string): string {
  return `${baseUrl}-${type === 'password' ? 'password' : 'totp'}?token=${token}&type=${type}`;
}

/** La notificación que pide el reset y la que lo confirma. */
export function resetNotificationTypes(type: ResetType) {
  return type === 'password'
    ? ({ request: 'SOLICITUD_RESET_PASSWORD', confirmed: 'RESET_PASSWORD', audit: 'PASSWORD_RESET_CONFIRMED' } as const)
    : ({ request: 'SOLICITUD_RESET_MFA', confirmed: 'RESET_MFA', audit: 'MFA_RESET_CONFIRMED' } as const);
}
