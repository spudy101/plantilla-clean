// modules/schemas/notification/repositories/verification-code.repository.ts
//
// Códigos OTP (email, teléfono, firma de contrato). origin_session_id lo completa la extensión de
// Prisma al crear: null en los OTP de onboarding y en el challenge SMS de login (rutas públicas,
// pre-sesión); con valor al activar MFA y al firmar contrato, que sí son autenticados.
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { VerificationCode, VerificationCodeType } from '../../../shared/database/generated/prisma/client';

const RATE_LIMIT_SECONDS = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

class VerificationCodeRepository extends PrismaRepository {
  static RATE_LIMIT_SECONDS = RATE_LIMIT_SECONDS;

  async findById(verificationCodeId: string): Promise<VerificationCode | null> {
    return (await this.db()).verificationCode.findUnique({ where: { verificationCodeId } });
  }

  /** Último código vigente y sin verificar del contacto. */
  async findActiveByContact(type: VerificationCodeType, contactValue: string): Promise<VerificationCode | null> {
    return (await this.db()).verificationCode.findFirst({
      where: { type, contactValue, expiresAt: { gt: new Date() }, verifiedAt: null },
      orderBy: { createdAt: 'desc' }
    });
  }

  /** Último código verificado del contacto. */
  async findVerifiedByContact(type: VerificationCodeType, contactValue: string): Promise<VerificationCode | null> {
    return (await this.db()).verificationCode.findFirst({
      where: { type, contactValue, verifiedAt: { not: null } },
      orderBy: { verifiedAt: 'desc' }
    });
  }

  async deleteVerifiedByContact(type: VerificationCodeType, contactValue: string): Promise<number> {
    return (await (await this.db()).verificationCode.deleteMany({ where: { type, contactValue, verifiedAt: { not: null } } })).count;
  }

  async create({
    type,
    contactValue,
    code,
    expiresAt
  }: {
    type: VerificationCodeType;
    contactValue: string;
    code: string;
    expiresAt: Date;
  }): Promise<VerificationCode> {
    // Whitelist estricta de campos: nadie puede sembrar un código ya verificado o con intentos.
    return (await this.db()).verificationCode.create({ data: { type, contactValue, code, expiresAt, verifiedAt: null } });
  }

  /** Marca el código como verificado; una fecha inválida se reemplaza por ahora. Null si no existe. */
  async markAsVerified(verificationCodeId: string, verifiedAt: Date = new Date()): Promise<VerificationCode | null> {
    const date = verifiedAt instanceof Date && !Number.isNaN(verifiedAt.getTime()) ? verifiedAt : new Date();
    const [row] = await (await this.db()).verificationCode.updateManyAndReturn({ where: { verificationCodeId }, data: { verifiedAt: date } });
    return row ?? null;
  }

  /**
   * Rate limiting: segundos que faltan para poder pedir otro código (0 = ya se puede). Cuenta desde el
   * último código sin verificar del contacto; el que llama lo devuelve como Retry-After.
   */
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

  /** Suma un intento si el código sigue vigente y sin verificar; devuelve las filas afectadas (0 o 1). */
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

export default new VerificationCodeRepository();
