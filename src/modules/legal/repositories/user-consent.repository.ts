// modules/schemas/records/legal/repositories/user-consent.repository.ts
//
// Consentimientos otorgados (RF-ADM-04). origin_session_id / origin_correlation_id los completa la
// extensión de Prisma al crear (shared/database/prisma-extensions.ts), desde el contexto de la request.
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { PageRequest } from '../../../shared/http/pagination';
import type { Prisma, UserConsent } from '../../../shared/database/generated/prisma/client';

// Mismos campos que los include de Sequelize
const CONSENT_TYPE_SELECT = {
  consentTypeId: true,
  code: true,
  name: true,
  isMandatory: true,
  isRevocable: true
} satisfies Prisma.ConsentTypeSelect;

const PRIVACY_POLICY_SELECT = {
  privacyPolicyId: true,
  version: true,
  documentUrl: true,
  effectiveDate: true
} satisfies Prisma.PrivacyPolicySelect;

const USER_SELECT = {
  userId: true,
  username: true,
  person: { select: { firstName: true, lastName: true } }
} satisfies Prisma.UserSelect;

const WITH_TYPE_AND_POLICY = {
  consentType: { select: CONSENT_TYPE_SELECT },
  privacyPolicy: { select: PRIVACY_POLICY_SELECT }
} satisfies Prisma.UserConsentInclude;

const WITH_TYPE_POLICY_AND_USER = {
  ...WITH_TYPE_AND_POLICY,
  user: { select: USER_SELECT }
} satisfies Prisma.UserConsentInclude;

class UserConsentRepository extends PrismaRepository {
  async findCurrentByUser(userId: string) {
    return (await this.db()).userConsent.findMany({
      where: { userId, isCurrent: true },
      include: WITH_TYPE_AND_POLICY,
      orderBy: { grantedAt: 'desc' }
    });
  }

  async findCurrentByUserAndType(userId: string, consentTypeId: string): Promise<UserConsent | null> {
    return (await this.db()).userConsent.findFirst({ where: { userId, consentTypeId, isCurrent: true } });
  }

  /** Filas por id (hidratación del session-trace). */
  async findByIds(ids: readonly string[]): Promise<UserConsent[]> {
    if (ids.length === 0) {
      return [];
    }
    return (await this.db()).userConsent.findMany({ where: { userConsentId: { in: [...ids] } } });
  }

  async findHistoryByUser(userId: string, page: PageRequest) {
    const db = await this.db();
    const where = { userId } satisfies Prisma.UserConsentWhereInput;
    const [rows, count] = await Promise.all([
      db.userConsent.findMany({
        where,
        include: WITH_TYPE_POLICY_AND_USER,
        ...this.paginationArgs(page, 'userConsentId')
      }),
      db.userConsent.count({ where })
    ]);
    return { rows, count };
  }

  /**
   * Otorga un consentimiento. Si ya existe uno vigente para user+type, lo marca como no vigente
   * antes de crear el nuevo, de forma atómica (en la unidad de trabajo del llamador si hay una).
   */
  grant({
    userId,
    consentTypeId,
    privacyPolicyId,
    ip,
    userAgent
  }: {
    userId: string;
    consentTypeId: string;
    privacyPolicyId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<UserConsent> {
    return this.atomic(async db => {
      await db.userConsent.updateMany({ where: { userId, consentTypeId, isCurrent: true }, data: { isCurrent: false } });
      return db.userConsent.create({
        data: {
          userId,
          consentTypeId,
          privacyPolicyId: privacyPolicyId || null,
          grantedAt: new Date(),
          grantedIp: ip || null,
          grantedUserAgent: userAgent || null,
          isCurrent: true
        }
      });
    });
  }

  /** Revoca el consentimiento vigente de un usuario para un tipo; null si no había uno. */
  revoke({
    userId,
    consentTypeId,
    ip,
    reason
  }: {
    userId: string;
    consentTypeId: string;
    ip?: string | null;
    reason?: string | null;
  }): Promise<UserConsent | null> {
    return this.atomic(async db => {
      const current = await db.userConsent.findFirst({ where: { userId, consentTypeId, isCurrent: true } });
      if (!current) {
        return null;
      }
      return db.userConsent.update({
        where: { userConsentId: current.userConsentId },
        data: { revokedAt: new Date(), revokedIp: ip || null, revocationReason: reason || null, isCurrent: false }
      });
    });
  }

  /** Revoca todos los consentimientos vigentes de un usuario (derecho de supresión). */
  async revokeAll(userId: string): Promise<number> {
    const { count } = await (await this.db()).userConsent.updateMany({
      where: { userId, isCurrent: true },
      data: { revokedAt: new Date(), isCurrent: false, revocationReason: 'right_to_erasure' }
    });
    return count;
  }

  async findAllPaginatedForAdmin(
    filters: UserConsentRepository.AdminFilters = {},
    page: PageRequest
  ) {
    const where: Prisma.UserConsentWhereInput = {};
    if (filters.userId) {
      where.userId = filters.userId;
    }
    if (filters.isCurrent !== undefined) {
      where.isCurrent = filters.isCurrent;
    }
    if (filters.dateFrom != null || filters.dateTo != null) {
      where.grantedAt = {
        ...(filters.dateFrom != null ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo != null ? { lte: filters.dateTo } : {})
      };
    }
    if (filters.consentTypeCode) {
      where.consentType = { code: filters.consentTypeCode };
    }

    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.userConsent.findMany({
        where,
        include: WITH_TYPE_POLICY_AND_USER,
        ...this.paginationArgs(page, 'userConsentId')
      }),
      db.userConsent.count({ where })
    ]);
    return { rows, count };
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace UserConsentRepository {
  export interface AdminFilters {
    userId?: string;
    isCurrent?: boolean;
    dateFrom?: string | Date;
    dateTo?: string | Date;
    consentTypeCode?: string;
  }
}

export default new UserConsentRepository();
