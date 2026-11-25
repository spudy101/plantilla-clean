// Salidas del panel de clientes: detalle, listado y la confirmación de cada acción sobre una cuenta.
//
// Las confirmaciones devuelven el dato enmascarado igual que el resto de las vistas: el administrador ya
// conoce el valor (lo acaba de escribir).
import MaskingUtil from '../../../../shared/domain/pii/masking.util';
import type { AccountTarget, ClientAccount, RoleRef } from '../../domain/client-account';
import { toContactOutput, toLocationOutput, toPersonOutput, toUserOutput } from '../../../../shared/application/account-views';

/** Un rol como sale en el resto de la API (mismo formato que el catálogo de roles). */
export function toRoleOutput(role: RoleRef | null | undefined) {
  return role
    ? { roleId: role.roleId, name: role.name, description: role.description || null, isActive: role.isActive, createdAt: role.createdAt, updatedAt: role.updatedAt }
    : null;
}

/** Opción del filtro por rol del listado (misma forma que en el listado de usuarios internos). */
export function toRoleOptionOutput(role: RoleRef) {
  return { roleId: role.roleId, name: role.name, description: role.description ?? null };
}

function toPersonDetail(person: NonNullable<ClientAccount['person']>) {
  const built = toPersonOutput(person, { includeGender: true, includeNationality: true });
  if (!built) {
    return null;
  }
  if (person.contact) {
    built.contact = toContactOutput(person.contact);
  }
  if (person.location) {
    built.location = toLocationOutput(person.location);
  }
  return built;
}

/** Detalle: la cuenta con su rol y avatar y, si tiene, la persona con contacto y ubicación. */
export function toAccountDetailOutput(account: ClientAccount) {
  const result: { user: ReturnType<typeof toUserOutput>; person?: ReturnType<typeof toPersonDetail> } = {
    user: toUserOutput(account, { includeRole: true, includeAvatar: true })
  };
  if (account.person) {
    result.person = toPersonDetail(account.person);
  }
  return result;
}

/** Fila del listado: lo justo para identificar la cuenta, con documento y email enmascarados. */
export function toAccountListItemOutput(account: ClientAccount) {
  const result: {
    userId: string;
    username: string;
    isActive: boolean | null;
    deletedAt: Date | null;
    totpEnabled: boolean | null;
    smsMfaEnabled: boolean;
    preferredMfaMethod: string;
    createdAt: Date;
    person?: { firstName: string; lastName: string; nationalId: string | null };
    email?: string | null;
    emailVerified?: boolean;
    role?: ReturnType<typeof toRoleOutput>;
  } = {
    userId: account.userId,
    username: account.username,
    isActive: account.isActive,
    deletedAt: account.deletedAt ?? null,
    totpEnabled: account.totpEnabled,
    smsMfaEnabled: account.smsMfaEnabled ?? false,
    preferredMfaMethod: account.preferredMfaMethod ?? 'none',
    createdAt: account.createdAt
  };
  if (account.person) {
    result.person = {
      firstName: account.person.firstName,
      lastName: account.person.lastName,
      nationalId: MaskingUtil.maskDocumentId(account.person.nationalId ?? null)
    };
    if (account.person.contact) {
      result.email = MaskingUtil.maskEmail(account.person.contact.email ?? null);
      result.emailVerified = !!account.person.contact.emailVerifiedAt;
    }
  }
  if (account.role) {
    result.role = toRoleOutput(account.role);
  }
  return result;
}

export function toAccountCreatedOutput(account: ClientAccount, temporaryPassword: string) {
  return { user: toAccountDetailOutput(account), temporaryPassword };
}

export function toPasswordResetOutput(account: AccountTarget) {
  return {
    userId: account.userId,
    username: account.username,
    email: MaskingUtil.maskEmail(account.person?.contact?.email) || null
  };
}

export function toEmailChangedOutput(account: AccountTarget, oldEmail: string, newEmail: string) {
  return {
    userId: account.userId,
    username: account.username,
    oldEmail: MaskingUtil.maskEmail(oldEmail) || null,
    newEmail: MaskingUtil.maskEmail(newEmail) || null,
    emailVerified: true
  };
}

export function toNationalIdChangedOutput(account: AccountTarget, oldNationalId: string | null, newNationalId: string) {
  return {
    userId: account.userId,
    username: account.username,
    oldNationalId: MaskingUtil.maskDocumentId(oldNationalId) || null,
    newNationalId: MaskingUtil.maskDocumentId(newNationalId) || null
  };
}

export function toAccountStatusOutput(account: AccountTarget, isActive: boolean, action: 'activate' | 'deactivate') {
  return { userId: account.userId, username: account.username, isActive, action };
}

export function toMfaDisabledOutput(account: AccountTarget) {
  return { userId: account.userId, username: account.username, totpEnabled: false, smsMfaEnabled: false, preferredMfaMethod: 'none' };
}

export function toRoleChangedOutput(account: AccountTarget, oldRole: RoleRef | null, newRole: RoleRef) {
  return { userId: account.userId, username: account.username, oldRole: toRoleOutput(oldRole), newRole: toRoleOutput(newRole) };
}
