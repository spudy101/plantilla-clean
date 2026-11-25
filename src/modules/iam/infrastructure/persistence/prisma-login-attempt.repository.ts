// Adaptador Prisma de los intentos de login (puerto LoginAttemptRepository).
//
// Intentos de login. El documento se guarda cifrado (lo cifra este repositorio: no está en la extensión
// de PII) con su hash de búsqueda, y el bloqueo de la cuenta se consulta por ese hash.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { LoginAttemptRepository } from '../../application/ports/credential-reset-repository.port';
import type { AccountBlock, LoginAttempt } from '../../domain/login-attempt';
import EncryptionUtil from '../../../../shared/infrastructure/security/encryption.util';
import HashUtil from '../../../../shared/infrastructure/security/hash.util';

const MS_PER_MINUTE = 60 * 1000;

export class PrismaLoginAttemptRepository extends PrismaRepository implements LoginAttemptRepository {
  static TIMEFRAMES = {
    BLOCK_WINDOW: 15, // minutos
    CLEANUP_DAYS: 90
  };

  /**
   * Registra un intento. Origen de la sesión: en los FALLIDOS la sesión nunca llegó a existir y queda null;
   * en los EXITOSOS el llamador lo pasa explícito (`originSessionId`): `POST /auth/login` es ruta pública,
   * el contexto de la request no tiene el sessionId aunque la sesión ya se haya creado. Uno explícito gana
   * sobre el que completa la extensión de Prisma.
   */
  async record(attempt: LoginAttempt): Promise<void> {
    const { nationalId, ...rest } = attempt;
    await (await this.db()).userLoginAttempt.create({
      data: {
        ...rest,
        nationalId: nationalId ? EncryptionUtil.encrypt(nationalId) : nationalId,
        nationalIdHash: nationalId ? HashUtil.hashForSearch(nationalId) : null,
        attemptedAt: new Date()
      }
    });
  }

  /** null si la cuenta no está bloqueada; si lo está, hasta cuándo y cuántos minutos faltan. */
  async findBlock(nationalId: string): Promise<AccountBlock | null> {
    const lastAttempt = await (await this.db()).userLoginAttempt.findFirst({
      where: { nationalIdHash: HashUtil.hashForSearch(nationalId) },
      orderBy: { attemptedAt: 'desc' },
      select: { blockedUntil: true }
    });
    if (!lastAttempt?.blockedUntil) {
      return null;
    }
    const now = new Date();
    const blockedUntil = new Date(lastAttempt.blockedUntil);
    if (blockedUntil > now) {
      return {
        blocked: true,
        blockedUntil,
        remainingMinutes: Math.ceil((blockedUntil.getTime() - now.getTime()) / MS_PER_MINUTE)
      };
    }
    return null;
  }
}

