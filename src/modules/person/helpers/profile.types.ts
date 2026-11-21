// modules/schemas/kyc/person/helpers/profile.types.ts
//
// Entradas de ProfileHelper (las usan también los services de perfil y admin). Solo tipos.

export type PhoneType = 'primary' | 'secondary';

/** Contexto HTTP de auditoría (algunos call-sites lo arman con ip, otros con ipAddress). */
export interface AuditInfo {
  ip?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Quién hace el cambio y por qué: va a user_change_logs. */
export interface ChangeActor {
  userId: string;
  changedByUserId: string;
  changedByRole: 'admin' | 'user' | 'system';
  changeReason?: string | null;
  auditContext: AuditInfo;
}

export interface LocationInput {
  countryId?: string | null;
  departmentId: string;
  cityId: string;
  postalCode?: string | null;
  type?: string | null;
  address: string;
}

export interface NamesInput {
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  secondLastName?: string | null;
}

export interface UpdateEmailParams extends ChangeActor {
  personId: string;
  newEmail: string;
  /** true cuando lo hace un admin (no exige OTP verificado) */
  skipVerificationCheck?: boolean;
}

export interface UpdatePhoneParams extends Partial<Pick<ChangeActor, 'userId' | 'changedByUserId' | 'changedByRole'>> {
  personId: string;
  phone: string;
  phonePrefixId: string;
  phoneType: PhoneType;
  auditContext?: AuditInfo;
}

export interface UpdatePasswordParams extends ChangeActor {
  newPassword: string;
}

export interface UpdateNationalIdParams extends ChangeActor {
  personId: string;
  newNationalId: string;
  documentTypeId?: string | null;
  role: { name: string };
}

export interface DeleteAccountParams extends ChangeActor {
  personId: string;
  nationalId: string | null;
  email?: string | null;
  username: string;
  firstName?: string | null;
}
