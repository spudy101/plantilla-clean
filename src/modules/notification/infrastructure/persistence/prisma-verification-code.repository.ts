// Adaptador Prisma del puerto VerificationCodeRepository (OTP de email, teléfono y firma de contrato).
// origin_session_id lo completa la extensión de Prisma al crear: null en las rutas públicas (pre-sesión).
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { VerificationCodeType } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { NewVerificationCode, VerificationCodeRepository } from '../../application/ports/verification-code-repository.port';
import type { VerificationCode } from '../../domain/verification-code';
import { NotificationMapper } from './notification.mapper';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RATE_LIMIT_SECONDS = 60;

export class PrismaVerificationCodeRepository extends PrismaRepository implements VerificationCodeRepository {
  static RATE_LIMIT_SECONDS = RATE_LIMIT_SECONDS;

  async findById(verificationCodeId: string): Promise<VerificationCode | null> {
    const row = await (await this.db()).verificationCode.findUnique({ where: { verificationCodeId } });
    return row ? NotificationMapper.verificationCodeToDomain(row) : null;
  }

  async findActiveByContact(type: VerificationCodeType, contactValue: string): Promise<VerificationCode | null> {
    const row = await (await this.db()).verificationCode.findFirst({
      where: { type, contactValue, expiresAt: { gt: new Date() }, verifiedAt: null },
      orderBy: { createdAt: 'desc' }
    });
    return row ? NotificationMapper.verificationCodeToDomain(row) : null;
  }

  /** Último código verificado del contacto (person e iam confirman así un email o teléfono). */
  async findVerifiedByContact(type: VerificationCodeType, contactValue: string): Promise<VerificationCode | null> {
    const row = await (await this.db()).verificationCode.findFirst({
      where: { type, contactValue, verifiedAt: { not: null } },
      orderBy: { verifiedAt: 'desc' }
    });
    return row ? NotificationMapper.verificationCodeToDomain(row) : null;
  }

  async deleteVerifiedByContact(type: VerificationCodeType, contactValue: string): Promise<number> {
    return (await (await this.db()).verificationCode.deleteMany({ where: { type, contactValue, verifiedAt: { not: null } } })).count;
  }

  async create({ type, contactValue, code, expiresAt }: NewVerificationCode): Promise<VerificationCode> {
    // Whitelist estricta de campos: nadie puede sembrar un código ya verificado o con intentos.
    const row = await (await this.db()).verificationCode.create({
      data: { type: type as VerificationCodeType, contactValue, code, expiresAt, verifiedAt: null }
    });
    return NotificationMapper.verificationCodeToDomain(row);
  }

  /** Una fecha inválida se reemplaza por ahora. null si no existe. */
  async markAsVerified(verificationCodeId: string, verifiedAt: Date = new Date()): Promise<VerificationCode | null> {
    const date = verifiedAt instanceof Date && !Number.isNaN(verifiedAt.getTime()) ? verifiedAt : new Date();
    const [row] = await (await this.db()).verificationCode.updateManyAndReturn({ where: { verificationCodeId }, data: { verifiedAt: date } });
    return row ? NotificationMapper.verificationCodeToDomain(row) : null;
  }

  /** Cuenta desde el último código sin verificar del contacto; quien llama lo devuelve como Retry-After. */
  async secondsUntilNewCode(type: VerificationCodeType, contactValue: string): Promise<number> {
    const threshold = new Date(Date.now() - RATE_LIMIT_SECONDS * 1000);
    const last = await (await this.db()).verificationCode.findFirst({
      where: { type, contactValue, createdAt: { gte: threshold }, verifiedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    });
    if (!last) {
      return 0;
    }
    return Math.max(1, Math.ceil((last.createdAt.getTime() + RATE_LIMIT_SECONDS * 1000 - Date.now()) / 1000));
  }

  async incrementAttempts(verificationCodeId: string): Promise<number> {
    const { count } = await (await this.db()).verificationCode.updateMany({
      where: { verificationCodeId, verifiedAt: null, expiresAt: { gt: new Date() } },
      data: { attempts: { increment: 1 } }
    });
    return count;
  }

  async deleteExpired(): Promise<number> {
    return (await (await this.db()).verificationCode.deleteMany({ where: { verifiedAt: null, expiresAt: { lt: new Date() } } })).count;
  }

  async deleteOldVerified(retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * MS_PER_DAY);
    return (await (await this.db()).verificationCode.deleteMany({ where: { verifiedAt: { lt: cutoff } } })).count;
  }
}
