// Piezas de salida de person: cuenta, persona, contacto, ubicación y referencia. Las usan las respuestas de
// person y, por el index.ts transitorio, las de iam (login, registro, usuarios internos).
//
// La PII ya llega en claro (la descifra la infraestructura) y sale ENMASCARADA salvo que se pida la vista
// completa del propio titular ({ unmask: true }). Las entradas son laxas a propósito: aceptan tanto las
// entidades de person como las filas que arma iam.
import MaskingUtil from '../../../../shared/domain/pii/masking.util';

type Maybe<T> = T | null | undefined;

/** Objeto de salida con campos opcionales que se agregan según las opciones de build. */
type Dto = Record<string, unknown>;

export interface ContactView {
  personContactId: string;
  personId: string;
  email?: Maybe<string>;
  emailVerifiedAt?: Maybe<Date>;
  phonePrimary?: Maybe<string>;
  phonePrimaryPrefixId?: Maybe<string>;
  phonePrimaryVerifiedAt?: Maybe<Date>;
  phoneSecondary?: Maybe<string>;
  phoneSecondaryPrefixId?: Maybe<string>;
  phoneSecondaryVerifiedAt?: Maybe<Date>;
  phonePrimaryPrefix?: Maybe<{ prefix?: Maybe<string> }>;
  phoneSecondaryPrefix?: Maybe<{ prefix?: Maybe<string> }>;
}

interface NamedView {
  name?: Maybe<string>;
  code?: Maybe<string>;
  iconUrl?: Maybe<string>;
  daneCode?: Maybe<string>;
}

export interface LocationView {
  personLocationId: string;
  personId: string;
  address?: Maybe<string>;
  postalCode?: Maybe<string>;
  type?: Maybe<string>;
  countryId?: Maybe<string>;
  departmentId?: Maybe<string>;
  cityId?: Maybe<string>;
  country?: Maybe<NamedView & { countryId: string }>;
  department?: Maybe<NamedView & { departmentId: string }>;
  city?: Maybe<NamedView & { cityId: string }>;
}

export interface UserView {
  userId: string;
  username?: Maybe<string>;
  personId?: Maybe<string>;
  roleId?: Maybe<string>;
  avatarId?: Maybe<string>;
  isActive?: Maybe<boolean>;
  deletedAt?: Maybe<Date>;
  totpEnabled?: Maybe<boolean>;
  smsMfaEnabled?: Maybe<boolean>;
  preferredMfaMethod?: Maybe<string>;
  privacyPolicyVersion?: Maybe<string>;
  privacyPolicyAcceptedAt?: Maybe<Date>;
  privacyPolicyAcceptedIp?: Maybe<string>;
  createdAt?: Maybe<Date>;
  updatedAt?: Maybe<Date>;
  role?: Maybe<{ roleId: string; name?: Maybe<string>; description?: Maybe<string> }>;
  avatar?: Maybe<{
    avatarId: string;
    name?: Maybe<string>;
    imageUrl?: Maybe<string>;
    theme?: Maybe<{ avatarThemeId: string; name?: Maybe<string> }>;
  }>;
}

export interface PersonView {
  personId: string;
  firstName?: Maybe<string>;
  lastName?: Maybe<string>;
  middleName?: Maybe<string>;
  secondLastName?: Maybe<string>;
  nationalId?: Maybe<string>;
  birthDate?: Maybe<Date>;
  genderId?: Maybe<string>;
  countryId?: Maybe<string>;
  documentTypeId?: Maybe<string>;
  createdAt?: Maybe<Date>;
  updatedAt?: Maybe<Date>;
  gender?: Maybe<{ genderId: string; name?: Maybe<string> }>;
  documentType?: Maybe<{ documentTypeId: string; code?: Maybe<string>; name?: Maybe<string> }>;
  /** País de la persona (relación `country`); sale como `nationality`. */
  country?: Maybe<NamedView & { countryId: string }>;
  contact?: Maybe<ContactView>;
  location?: Maybe<LocationView>;
  user?: Maybe<UserView>;
}

export interface ReferenceView {
  personReferenceId: string;
  referenceName?: Maybe<string>;
  referencePhone?: Maybe<string>;
  referenceType?: Maybe<string>;
  createdAt?: Maybe<Date>;
}

export interface UserOutputOptions {
  includeRole?: boolean;
  includeAvatar?: boolean;
}

export interface PersonOutputOptions {
  includeContact?: boolean;
  includeLocation?: boolean;
  includeUser?: boolean;
  includeGender?: boolean;
  includeNationality?: boolean;
  includeDocumentType?: boolean;
  userOptions?: UserOutputOptions;
  /** Vista del propio titular: la PII sale completa en vez de enmascarada. */
  unmask?: boolean;
}

// ── Contacto ───────────────────────────────────────────────────
export function toContactOutput(contact: Maybe<ContactView>, options: { unmask?: boolean } = {}) {
  if (!contact) {
    return null;
  }
  const { unmask = false } = options;
  const primaryPrefix = contact.phonePrimaryPrefix?.prefix || null;
  const secondaryPrefix = contact.phoneSecondaryPrefix?.prefix || null;

  const email = contact.email || null;
  const phonePrimary = contact.phonePrimary || null;
  const phoneSecondary = contact.phoneSecondary || null;
  const phonePrimaryFull = phonePrimary ? `${primaryPrefix || ''}${phonePrimary}` : null;
  const phoneSecondaryFull = phoneSecondary ? `${secondaryPrefix || ''}${phoneSecondary}` : null;

  const maskEmail = (value: string | null) => (value ? (unmask ? value : MaskingUtil.maskEmail(value)) : null);
  const maskPhone = (value: string | null) => (value ? (unmask ? value : MaskingUtil.maskPhone(value)) : null);

  return {
    personContactId: contact.personContactId,
    personId: contact.personId,

    email: maskEmail(email),
    emailVerifiedAt: contact.emailVerifiedAt || null,
    isEmailVerified: !!contact.emailVerifiedAt,

    phonePrimary: maskPhone(phonePrimary),
    phonePrimaryPrefixId: contact.phonePrimaryPrefixId || null,
    phonePrimaryPrefix: primaryPrefix,
    phonePrimaryFull: maskPhone(phonePrimaryFull),
    phonePrimaryVerifiedAt: contact.phonePrimaryVerifiedAt || null,
    isPhonePrimaryVerified: !!contact.phonePrimaryVerifiedAt,

    phoneSecondary: maskPhone(phoneSecondary),
    phoneSecondaryPrefixId: contact.phoneSecondaryPrefixId || null,
    phoneSecondaryPrefix: secondaryPrefix,
    phoneSecondaryFull: maskPhone(phoneSecondaryFull),
    phoneSecondaryVerifiedAt: contact.phoneSecondaryVerifiedAt || null,
    isPhoneSecondaryVerified: !!contact.phoneSecondaryVerifiedAt
  };
}

// ── Ubicación ──────────────────────────────────────────────────
export function toLocationOutput(location: Maybe<LocationView>) {
  if (!location) {
    return null;
  }
  const dto: Dto = {
    personLocationId: location.personLocationId,
    personId: location.personId,
    address: location.address,
    postalCode: location.postalCode || null,
    type: location.type || null,
    countryId: location.countryId || null,
    departmentId: location.departmentId,
    cityId: location.cityId
  };
  if (location.country) {
    dto.country = {
      countryId: location.country.countryId,
      name: location.country.name,
      code: location.country.code,
      iconUrl: location.country.iconUrl || null
    };
  }
  if (location.department) {
    dto.department = {
      departmentId: location.department.departmentId,
      name: location.department.name,
      daneCode: location.department.daneCode || null
    };
  }
  if (location.city) {
    dto.city = { cityId: location.city.cityId, name: location.city.name, daneCode: location.city.daneCode || null };
  }
  return dto;
}

// ── Cuenta ─────────────────────────────────────────────────────
export function toUserOutput(user: Maybe<UserView>, options: UserOutputOptions = {}) {
  if (!user) {
    return null;
  }
  const { includeRole = false, includeAvatar = false } = options;
  const dto: Dto = {
    userId: user.userId,
    username: user.username,
    personId: user.personId,
    roleId: user.roleId,
    avatarId: user.avatarId || null,
    isActive: user.isActive,
    deletedAt: user.deletedAt ?? null,
    totpEnabled: user.totpEnabled,
    smsMfaEnabled: user.smsMfaEnabled ?? false,
    preferredMfaMethod: user.preferredMfaMethod ?? 'none',
    privacyPolicyVersion: user.privacyPolicyVersion || null,
    privacyPolicyAcceptedAt: user.privacyPolicyAcceptedAt || null,
    privacyPolicyAcceptedIp: user.privacyPolicyAcceptedIp || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
  if (includeRole && user.role) {
    dto.role = { roleId: user.role.roleId, name: user.role.name, description: user.role.description || null };
  }
  if (includeAvatar && user.avatar) {
    dto.avatar = {
      avatarId: user.avatar.avatarId,
      name: user.avatar.name,
      imageUrl: user.avatar.imageUrl || null,
      theme: user.avatar.theme ? { avatarThemeId: user.avatar.theme.avatarThemeId, name: user.avatar.theme.name } : null
    };
  }
  return dto;
}

// ── Persona ────────────────────────────────────────────────────
export function toPersonOutput(person: Maybe<PersonView>, options: PersonOutputOptions = {}) {
  if (!person) {
    return null;
  }
  const {
    includeContact = false,
    includeLocation = false,
    includeUser = false,
    includeGender = false,
    includeNationality = false,
    includeDocumentType = false,
    userOptions = {},
    unmask = false
  } = options;

  const nationalId = person.nationalId || null;
  const dto: Dto = {
    personId: person.personId,
    firstName: person.firstName,
    lastName: person.lastName,
    middleName: person.middleName || null,
    secondLastName: person.secondLastName || null,
    fullName: [person.firstName, person.middleName, person.lastName, person.secondLastName].filter(Boolean).join(' '),
    nationalId: nationalId ? (unmask ? nationalId : MaskingUtil.maskDocumentId(nationalId)) : null,
    birthDate: person.birthDate || null,
    genderId: person.genderId || null,
    countryId: person.countryId || null,
    documentTypeId: person.documentTypeId || null,
    createdAt: person.createdAt,
    updatedAt: person.updatedAt
  };
  if (includeGender && person.gender) {
    dto.gender = { genderId: person.gender.genderId, name: person.gender.name };
  }
  if (includeDocumentType && person.documentType) {
    dto.documentType = { documentTypeId: person.documentType.documentTypeId, code: person.documentType.code, name: person.documentType.name };
  }
  if (includeNationality && person.country) {
    dto.nationality = {
      countryId: person.country.countryId,
      name: person.country.name,
      code: person.country.code,
      iconUrl: person.country.iconUrl || null
    };
  }
  if (includeContact && person.contact) {
    dto.contact = toContactOutput(person.contact, { unmask });
  }
  if (includeLocation && person.location) {
    dto.location = toLocationOutput(person.location);
  }
  if (includeUser && person.user) {
    dto.user = toUserOutput(person.user, userOptions);
  }
  return dto;
}

// ── Referencia ─────────────────────────────────────────────────
export function toReferenceOutput(reference: Maybe<ReferenceView>) {
  if (!reference) {
    return null;
  }
  return {
    personReferenceId: reference.personReferenceId,
    referenceName: reference.referenceName,
    // Celular de un TERCERO (la referencia personal) → siempre enmascarado.
    referencePhone: MaskingUtil.maskPhone(reference.referencePhone) || null,
    referenceType: reference.referenceType,
    createdAt: reference.createdAt
  };
}
