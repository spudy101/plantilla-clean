// Adaptador Prisma del puerto PrivacyPolicyRepository.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type {
  PrivacyPolicyFilters,
  PrivacyPolicyPage,
  PrivacyPolicyRepository
} from '../../application/ports/privacy-policy-repository.port';
import type { NewPrivacyPolicyVersion, PrivacyPolicy } from '../../domain/privacy-policy';
import { LegalMapper } from './legal.mapper';

const LIST = { tiebreaker: 'privacyPolicyId', searchFields: ['version', 'summary'] };
const toDomain = LegalMapper.privacyPolicyToDomain;

export class PrismaPrivacyPolicyRepository extends PrismaRepository implements PrivacyPolicyRepository {
  async findActive(): Promise<PrivacyPolicy | null> {
    const row = await (await this.db()).privacyPolicy.findFirst({ where: { isActive: true } });
    return row ? toDomain(row) : null;
  }

  async findById(privacyPolicyId: string): Promise<PrivacyPolicy | null> {
    const row = await (await this.db()).privacyPolicy.findUnique({ where: { privacyPolicyId } });
    return row ? toDomain(row) : null;
  }

  async versionExists(version: string): Promise<boolean> {
    return (await (await this.db()).privacyPolicy.findUnique({ where: { version }, select: { privacyPolicyId: true } })) !== null;
  }

  /** Sin `sortBy` ordena por fecha de vigencia. */
  async list(filters: PrivacyPolicyFilters, pagination: PageRequest, search: string | null): Promise<PrivacyPolicyPage> {
    const { where, page } = this.listQuery(
      { ...filters },
      { ...pagination, sortBy: pagination.sortBy || 'effectiveDate' },
      search,
      LIST
    );
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.privacyPolicy.findMany({ where: where as Prisma.PrivacyPolicyWhereInput, ...page }),
      db.privacyPolicy.count({ where: where as Prisma.PrivacyPolicyWhereInput })
    ]);
    return { rows: rows.map(toDomain), count };
  }

  /** Desactiva la vigente y crea la nueva como activa, en una sola transacción (solo puede haber UNA). */
  publish(version: NewPrivacyPolicyVersion): Promise<PrivacyPolicy> {
    return this.atomic(async db => {
      await db.privacyPolicy.updateMany({ where: { isActive: true }, data: { isActive: false } });
      return toDomain(await db.privacyPolicy.create({ data: { ...version, isActive: true } }));
    });
  }
}
