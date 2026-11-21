// Componentes de salida del dominio legal (antes vivían en audit): tipo de consentimiento, referencia a la
// política de privacidad y consentimiento de un usuario. Los usan legal, person (perfil) y audit (traza de
// sesión) a través del index de legal. Cada componente tiene su esquema Zod de salida.
import type { DbDate, Maybe } from '../../../shared/types/db-rows';
import { z } from '../../../shared/validation/z';
import { dateTime } from '../../../shared/validation/output';

interface ConsentTypeRow {
  consentTypeId: string;
  code: string;
  name?: Maybe<string>;
  description?: Maybe<string>;
  isMandatory?: Maybe<boolean>;
  isRevocable?: Maybe<boolean>;
  isActive?: Maybe<boolean>;
  scope?: Maybe<string>;
  createdAt?: Maybe<DbDate>;
  updatedAt?: Maybe<DbDate>;
}

interface PrivacyPolicyRefRow {
  privacyPolicyId: string;
  version: string;
  documentUrl?: Maybe<string>;
  effectiveDate?: Maybe<DbDate>;
}

interface ConsentUserRow {
  userId: string;
  username?: Maybe<string>;
  person?: Maybe<{ firstName?: Maybe<string>; lastName?: Maybe<string> }>;
}

interface UserConsentRow {
  userConsentId: string;
  userId?: Maybe<string>;
  user?: Maybe<ConsentUserRow>;
  consentTypeId?: Maybe<string>;
  consentType?: Maybe<ConsentTypeRow>;
  privacyPolicy?: Maybe<PrivacyPolicyRefRow>;
  grantedAt?: Maybe<DbDate>;
  grantedIp?: Maybe<string>;
  originSessionId?: Maybe<string>;
  revokedAt?: Maybe<DbDate>;
  revocationReason?: Maybe<string>;
  isCurrent?: Maybe<boolean>;
  createdAt?: Maybe<DbDate>;
}

type UserConsentVariant = 'build' | 'buildForClient' | 'buildGranted';

function buildUserRef(user: Maybe<ConsentUserRow>) {
  if (!user) {
    return null;
  }
  return {
    userId: user.userId,
    username: user.username,
    fullName: [user.person?.firstName, user.person?.lastName].filter(Boolean).join(' ') || null
  };
}

// ============================================================
// CONSENT TYPE
// ============================================================

class ConsentTypeComponent {
  static build(consentType: Maybe<ConsentTypeRow>) {
    if (!consentType) {
      return null;
    }
    return {
      consentTypeId: consentType.consentTypeId,
      code: consentType.code,
      name: consentType.name,
      isMandatory: consentType.isMandatory,
      isRevocable: consentType.isRevocable,
      isActive: consentType.isActive,
      scope: consentType.scope
    };
  }

  static buildDetail(consentType: Maybe<ConsentTypeRow>) {
    if (!consentType) {
      return null;
    }
    return {
      ...ConsentTypeComponent.build(consentType),
      description: consentType.description ?? null,
      createdAt: consentType.createdAt,
      updatedAt: consentType.updatedAt
    };
  }

  static buildList(consentType: Maybe<ConsentTypeRow>) {
    if (!consentType) {
      return null;
    }
    return {
      ...ConsentTypeComponent.build(consentType),
      createdAt: consentType.createdAt
    };
  }
}

// ============================================================
// PRIVACY POLICY REF
// ============================================================

class PrivacyPolicyRefComponent {
  static build(policy: Maybe<PrivacyPolicyRefRow>) {
    if (!policy) {
      return null;
    }
    return {
      privacyPolicyId: policy.privacyPolicyId,
      version: policy.version,
      documentUrl: policy.documentUrl,
      effectiveDate: policy.effectiveDate
    };
  }
}

// ============================================================
// USER CONSENT — RF-ADM-04
// ============================================================

class UserConsentComponent {
  static build(record: Maybe<UserConsentRow>) {
    if (!record) {
      return null;
    }
    return {
      userConsentId: record.userConsentId,
      userId: record.userId,
      user: buildUserRef(record.user),
      consentType: ConsentTypeComponent.build(record.consentType),
      privacyPolicy: PrivacyPolicyRefComponent.build(record.privacyPolicy),
      grantedAt: record.grantedAt,
      grantedIp: record.grantedIp,
      // Solo variante admin: ata el consentimiento a su sesión de origen (user_sessions / audit_logs).
      originSessionId: record.originSessionId ?? null,
      revokedAt: record.revokedAt ?? null,
      revocationReason: record.revocationReason ?? null,
      isCurrent: record.isCurrent,
      createdAt: record.createdAt
    };
  }

  static buildForClient(record: Maybe<UserConsentRow>) {
    if (!record) {
      return null;
    }
    return {
      userConsentId: record.userConsentId,
      consentType: ConsentTypeComponent.build(record.consentType),
      privacyPolicy: PrivacyPolicyRefComponent.build(record.privacyPolicy),
      grantedAt: record.grantedAt,
      revokedAt: record.revokedAt ?? null,
      isCurrent: record.isCurrent
    };
  }

  static buildGranted(record: Maybe<UserConsentRow>) {
    if (!record) {
      return null;
    }
    return {
      userConsentId: record.userConsentId,
      consentTypeId: record.consentTypeId,
      grantedAt: record.grantedAt,
      isCurrent: record.isCurrent
    };
  }

  // Item de catálogo para el cliente: un tipo de consentimiento activo + el estado de otorgamiento del
  // usuario. Sin otorgamiento vigente (record null): granted=false y los campos de otorgamiento en null.
  static buildClientCatalogItem(consentType: Maybe<ConsentTypeRow>, record: Maybe<UserConsentRow>) {
    if (!consentType) {
      return null;
    }
    return {
      consentType: ConsentTypeComponent.build(consentType),
      granted: Boolean(record),
      userConsentId: record ? record.userConsentId : null,
      privacyPolicy: record ? PrivacyPolicyRefComponent.build(record.privacyPolicy) : null,
      grantedAt: record ? record.grantedAt : null,
      revokedAt: record ? (record.revokedAt ?? null) : null,
      isCurrent: record ? record.isCurrent : false
    };
  }

  static buildArray(records: Maybe<UserConsentRow[]>, variant: UserConsentVariant = 'build') {
    if (!records || records.length === 0) {
      return [];
    }
    return records.map(r => UserConsentComponent[variant](r));
  }
}

// ============================================================
// ESQUEMAS DE SALIDA
// ============================================================

export const ConsentTypeSchema = z.object({
  consentTypeId: z.uuid(),
  code: z.string().meta({ example: 'PRIVACY_POLICY' }),
  name: z.string().nullish(),
  isMandatory: z.boolean().nullish(),
  isRevocable: z.boolean().nullish(),
  isActive: z.boolean().nullish(),
  scope: z.string().nullish()
});
export const ConsentTypeListItemSchema = ConsentTypeSchema.extend({ createdAt: dateTime().nullish() });
export const ConsentTypeDetailSchema = ConsentTypeSchema.extend({
  description: z.string().nullable(),
  createdAt: dateTime().nullish(),
  updatedAt: dateTime().nullish()
});

export const PrivacyPolicyRefSchema = z.object({
  privacyPolicyId: z.uuid(),
  version: z.string().meta({ example: '1.0' }),
  documentUrl: z.string().nullish(),
  effectiveDate: dateTime().nullish()
});

const UserRefSchema = z.object({ userId: z.uuid(), username: z.string().nullish(), fullName: z.string().nullable() });

export const UserConsentSchema = z
  .object({
    userConsentId: z.uuid(),
    userId: z.string().nullish(),
    user: UserRefSchema.nullable(),
    consentType: ConsentTypeSchema.nullable(),
    privacyPolicy: PrivacyPolicyRefSchema.nullable(),
    grantedAt: dateTime().nullish(),
    grantedIp: z.string().nullish(),
    originSessionId: z.string().nullable().meta({ description: 'Sesión en que se otorgó (trazabilidad).' }),
    revokedAt: dateTime().nullable(),
    revocationReason: z.string().nullable(),
    isCurrent: z.boolean().nullish(),
    createdAt: dateTime().nullish()
  })
  .meta({ description: 'Consentimiento de un usuario (vista admin).' });

export const MyConsentSchema = z.object({
  userConsentId: z.uuid(),
  consentType: ConsentTypeSchema.nullable(),
  privacyPolicy: PrivacyPolicyRefSchema.nullable(),
  grantedAt: dateTime().nullish(),
  revokedAt: dateTime().nullable(),
  isCurrent: z.boolean().nullish()
});

export const ConsentGrantedSchema = z.object({
  userConsentId: z.uuid(),
  consentTypeId: z.string().nullish(),
  grantedAt: dateTime().nullish(),
  isCurrent: z.boolean().nullish()
});

export const MyConsentCatalogItemSchema = z
  .object({
    consentType: ConsentTypeSchema.nullable(),
    granted: z.boolean(),
    userConsentId: z.string().nullable(),
    privacyPolicy: PrivacyPolicyRefSchema.nullable(),
    grantedAt: dateTime().nullish(),
    revokedAt: dateTime().nullable(),
    isCurrent: z.boolean().nullish()
  })
  .meta({ description: 'Un tipo de consentimiento activo y si el usuario lo tiene otorgado.' });

export default { ConsentTypeComponent, PrivacyPolicyRefComponent, UserConsentComponent };
