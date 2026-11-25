// Adaptadores Prisma de las credenciales biométricas y sus challenges (puertos de biometric-repository.port.ts).
//
// Credenciales biométricas (WebAuthn) y sus challenges de un solo uso.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { BiometricChallenge, Prisma, UserBiometricCredential } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { BiometricChallengeRepository, BiometricCredentialRepository } from '../../application/ports/biometric-repository.port';
import type { ChallengeType } from '../../domain/biometric';
import { IamNotFoundError } from '../../domain/errors';

// TTL del challenge biométrico
const BIOMETRIC_CHALLENGE_TTL_MINUTES = 5;
const BIOMETRIC_CHALLENGE_TTL_MS = BIOMETRIC_CHALLENGE_TTL_MINUTES * 60 * 1000;

// ============================================================
// BiometricCredentialRepository
// ============================================================

export class PrismaBiometricCredentialRepository extends PrismaRepository implements BiometricCredentialRepository {
  /** Credencial activa por el credentialId que envía el dispositivo (login/finish). */
  async findByCredentialId(credentialId: string): Promise<UserBiometricCredential | null> {
    return (await this.db()).userBiometricCredential.findFirst({ where: { credentialId, isActive: true } });
  }

  /** Credencial por id, solo si pertenece al usuario. */
  async findByIdAndUser(biometricCredentialId: string, userId: string): Promise<UserBiometricCredential | null> {
    return (await this.db()).userBiometricCredential.findFirst({ where: { userBiometricCredentialId: biometricCredentialId, userId } });
  }

  /** Credencial activa del usuario en un dispositivo (para no registrar dos huellas en el mismo). */
  async findByUserAndDevice(userId: string, userTrustedDeviceId: string): Promise<UserBiometricCredential | null> {
    return (await this.db()).userBiometricCredential.findFirst({ where: { userId, userTrustedDeviceId, isActive: true } });
  }

  /** Credenciales activas del usuario, más recientes primero. */
  async findAllByUser(userId: string): Promise<UserBiometricCredential[]> {
    return (await this.db()).userBiometricCredential.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async create(
    data: Pick<
      Prisma.UserBiometricCredentialUncheckedCreateInput,
      'userId' | 'userTrustedDeviceId' | 'credentialId' | 'publicKey' | 'signCount'
    >
  ): Promise<UserBiometricCredential> {
    return (await this.db()).userBiometricCredential.create({
      data: {
        userId: data.userId,
        userTrustedDeviceId: data.userTrustedDeviceId,
        credentialId: data.credentialId,
        publicKey: data.publicKey,
        signCount: data.signCount || 0,
        isActive: true
      }
    });
  }

  /**
   * Actualiza sign_count y last_used_at después de un login exitoso. El sign_count debe ser siempre
   * mayor al anterior (anti-replay: lo verifica el service).
   */
  async updateAfterLogin(credentialId: string, signCount: number): Promise<number> {
    return (
      await (
        await this.db()
      ).userBiometricCredential.updateMany({ where: { credentialId }, data: { signCount, lastUsedAt: new Date() } })
    ).count;
  }

  /** Desactiva una credencial (borrado lógico). */
  async deactivate(biometricCredentialId: string): Promise<UserBiometricCredential> {
    const [row] = await (
      await this.db()
    ).userBiometricCredential.updateManyAndReturn({
      where: { userBiometricCredentialId: biometricCredentialId },
      data: { isActive: false }
    });
    if (!row) {
      throw new IamNotFoundError('Credencial biométrica no encontrada');
    }
    return row;
  }
}

// ============================================================
// BiometricChallengeRepository
// ============================================================

export class PrismaBiometricChallengeRepository extends PrismaRepository implements BiometricChallengeRepository {
  /** Crea un challenge sin usar con TTL de 5 minutos. */
  async create(
    data: { userId: string | null; challenge: string; type: ChallengeType }
  ): Promise<BiometricChallenge> {
    return (await this.db()).biometricChallenge.create({
      data: {
        userId: data.userId || null,
        challenge: data.challenge,
        type: data.type,
        used: false,
        expiresAt: new Date(Date.now() + BIOMETRIC_CHALLENGE_TTL_MS)
      }
    });
  }

  /** Challenge válido: mismo valor, no usado y no expirado. */
  async findValid(challenge: string): Promise<BiometricChallenge | null> {
    return (await this.db()).biometricChallenge.findFirst({ where: { challenge, used: false, expiresAt: { gt: new Date() } } });
  }

  /**
   * Marca el challenge como usado si todavía no lo estaba (justo antes de procesar la firma). Devuelve
   * si lo marcó: false = otro request lo consumió primero (replay).
   */
  async markAsUsed(challengeId: string): Promise<boolean> {
    return (
      (await (await this.db()).biometricChallenge.updateMany({ where: { biometricChallengeId: challengeId, used: false }, data: { used: true } }))
        .count > 0
    );
  }
}

