// Adaptador Prisma del puerto UserConsentRepository (RF-ADM-04). origin_session_id y origin_correlation_id
// los completa la extensión de Prisma al crear (shared/infrastructure/database/prisma-extensions), desde el
// contexto de la operación.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type {
  UserConsentAdminFilters,
  UserConsentPage,
  UserConsentRepository
} from '../../application/ports/user-consent-repository.port';
import type { ConsentGrant, ConsentRevocation, UserConsent } from '../../domain/user-consent';
import { LegalMapper } from './legal.mapper';

const toDomain = LegalMapper.userConsentToDomain;

const WITH_TYPE_AND_POLICY = {
  consentType: { select: { consentTypeId: true, code: true, name: true, isMandatory: true, isRevocable: true } },
  privacyPolicy: { select: { privacyPolicyId: true, version: true, documentUrl: true, effectiveDate: true } }
} satisfies Prisma.UserConsentInclude;

const WITH_TYPE_POLICY_AND_HOLDER = {
  ...WITH_TYPE_AND_POLICY,
  user: { select: { userId: true, username: true, person: { select: { firstName: true, lastName: true } } } }
} satisfies Prisma.UserConsentInclude;

export class PrismaUserConsentRepository extends PrismaRepository implements UserConsentRepository {
  async findCurrentByUser(userId: string): Promise<UserConsent[]> {
    const rows = await (await this.db()).userConsent.findMany({
      where: { userId, isCurrent: true },
      include: WITH_TYPE_AND_POLICY,
      orderBy: { grantedAt: 'desc' }
    });
    return rows.map(toDomain);
  }

  async findCurrentByUserAndType(userId: string, consentTypeId: string): Promise<UserConsent | null> {
    const row = await (await this.db()).userConsent.findFirst({ where: { userId, consentTypeId, isCurrent: true } });
    return row ? toDomain(row) : null;
  }

  listHistoryByUser(userId: string, page: PageRequest): Promise<UserConsentPage> {
    return this.page({ userId }, page);
  }

  listForAdmin(filters: UserConsentAdminFilters, page: PageRequest): Promise<UserConsentPage> {
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
    return this.page(where, page);
  }

  grant({ userId, consentTypeId, privacyPolicyId, ip, userAgent }: ConsentGrant): Promise<UserConsent> {
    return this.atomic(async db => {
      await db.userConsent.updateMany({ where: { userId, consentTypeId, isCurrent: true }, data: { isCurrent: false } });
      const row = await db.userConsent.create({
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
      return toDomain(row);
    });
  }

  revokeCurrent({ userId, consentTypeId, ip, reason }: ConsentRevocation): Promise<UserConsent | null> {
    return this.atomic(async db => {
      const current = await db.userConsent.findFirst({ where: { userId, consentTypeId, isCurrent: true } });
      if (!current) {
        return null;
      }
      const row = await db.userConsent.update({
        where: { userConsentId: current.userConsentId },
        data: { revokedAt: new Date(), revokedIp: ip || null, revocationReason: reason || null, isCurrent: false }
      });
      return toDomain(row);
    });
  }

  // ── Transitorio para módulos sin migrar (ver index.ts) ─────────────────────

  /** @deprecated Hidratación del session-trace de audit; pasará a un puerto de audit al migrarlo. */
  async findByIds(ids: readonly string[]): Promise<UserConsent[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await (await this.db()).userConsent.findMany({ where: { userConsentId: { in: [...ids] } } });
    return rows.map(toDomain);
  }

  /** @deprecated Derecho de supresión (person); pasará a un caso de uso al migrar person. */
  async revokeAll(userId: string): Promise<number> {
    const { count } = await (await this.db()).userConsent.updateMany({
      where: { userId, isCurrent: true },
      data: { revokedAt: new Date(), isCurrent: false, revocationReason: 'right_to_erasure' }
    });
    return count;
  }

  private async page(where: Prisma.UserConsentWhereInput, page: PageRequest): Promise<UserConsentPage> {
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.userConsent.findMany({ where, include: WITH_TYPE_POLICY_AND_HOLDER, ...this.paginationArgs(page, 'userConsentId') }),
      db.userConsent.count({ where })
    ]);
    return { rows: rows.map(toDomain), count };
  }
}
