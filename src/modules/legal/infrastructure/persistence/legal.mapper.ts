// Mappers fila de Prisma ↔ entidades de legal. Es el único lugar que conoce las dos formas: si cambia el
// esquema de la base, cambia esto y no el dominio.
import type { ConsentType as ConsentTypeRow, PrivacyPolicy as PrivacyPolicyRow, UserConsent as UserConsentRow } from '../../../../shared/infrastructure/database/generated/prisma/client';
import { ConsentType } from '../../domain/consent-type';
import { PrivacyPolicy } from '../../domain/privacy-policy';
import { UserConsent, type ConsentTypeRef, type PrivacyPolicyRef } from '../../domain/user-consent';

/** Lo que traen las consultas de consentimientos además de la fila (según el include). */
export interface UserConsentRowWithRefs extends UserConsentRow {
  consentType?: Pick<ConsentTypeRow, 'consentTypeId' | 'code' | 'name' | 'isMandatory' | 'isRevocable'>;
  privacyPolicy?: Pick<PrivacyPolicyRow, 'privacyPolicyId' | 'version' | 'documentUrl' | 'effectiveDate'> | null;
  user?: { userId: string; username: string | null; person: { firstName: string | null; lastName: string | null } | null };
}

export const LegalMapper = {
  consentTypeToDomain(row: ConsentTypeRow): ConsentType {
    return ConsentType.restore({
      consentTypeId: row.consentTypeId,
      code: row.code,
      name: row.name,
      description: row.description,
      isMandatory: row.isMandatory,
      isRevocable: row.isRevocable,
      isActive: row.isActive,
      scope: row.scope,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    });
  },

  privacyPolicyToDomain(row: PrivacyPolicyRow): PrivacyPolicy {
    return PrivacyPolicy.restore({
      privacyPolicyId: row.privacyPolicyId,
      version: row.version,
      documentUrl: row.documentUrl,
      documentHash: row.documentHash,
      summary: row.summary,
      isActive: row.isActive,
      effectiveDate: row.effectiveDate,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    });
  },

  userConsentToDomain(row: UserConsentRowWithRefs): UserConsent {
    return UserConsent.restore({
      userConsentId: row.userConsentId,
      userId: row.userId,
      consentTypeId: row.consentTypeId,
      privacyPolicyId: row.privacyPolicyId,
      grantedAt: row.grantedAt,
      grantedIp: row.grantedIp,
      revokedAt: row.revokedAt,
      revocationReason: row.revocationReason,
      isCurrent: row.isCurrent,
      originSessionId: row.originSessionId,
      createdAt: row.createdAt,
      // Solo lo que trajo la consulta: un campo que no se pidió queda ausente (no null)
      ...(row.consentType ? { consentType: consentTypeRef(row.consentType) } : {}),
      ...(row.privacyPolicy !== undefined ? { privacyPolicy: row.privacyPolicy ? policyRef(row.privacyPolicy) : null } : {}),
      ...(row.user
        ? {
            holder: {
              userId: row.user.userId,
              username: row.user.username,
              firstName: row.user.person?.firstName ?? null,
              lastName: row.user.person?.lastName ?? null
            }
          }
        : {})
    });
  }
};

function consentTypeRef(row: NonNullable<UserConsentRowWithRefs['consentType']>): ConsentTypeRef {
  return {
    consentTypeId: row.consentTypeId,
    code: row.code,
    name: row.name,
    isMandatory: row.isMandatory,
    isRevocable: row.isRevocable
  };
}

function policyRef(row: NonNullable<UserConsentRowWithRefs['privacyPolicy']>): PrivacyPolicyRef {
  return {
    privacyPolicyId: row.privacyPolicyId,
    version: row.version,
    documentUrl: row.documentUrl,
    effectiveDate: row.effectiveDate
  };
}
