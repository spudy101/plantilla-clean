// Adaptador Prisma de los tokens de reset de contraseña / MFA (puerto CredentialResetRepository).
//
// Tokens de reset de contraseña / MFA. Flujo NO autenticado: origin_session_id queda null; la extensión
// de Prisma completa el correlationId del request.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { CredentialResetRepository } from '../../application/ports/credential-reset-repository.port';
import type { CredentialResetWithUser, ResetType } from '../../domain/credential-reset';

const WITH_USER = {
  user: {
    select: {
      userId: true,
      authUsername: true,
      person: { select: { personId: true, firstName: true, contact: { select: { email: true } } } }
    }
  }
} satisfies Prisma.CredentialResetInclude;


const valid = (token: string): Prisma.CredentialResetWhereInput => ({ token, used: false, expiresAt: { gt: new Date() } });

export class PrismaCredentialResetRepository extends PrismaRepository implements CredentialResetRepository {
  /** Token válido con el usuario, su persona y el email de contacto (aplicar el reset y avisar). */
  async findValidWithUser(token: string): Promise<CredentialResetWithUser | null> {
    return (await this.db()).credentialReset.findFirst({ where: valid(token), include: WITH_USER });
  }

  /**
   * Marca el token como usado si todavía no lo estaba. Devuelve si lo marcó: false = otro request lo
   * consumió primero.
   */
  async markAsUsed(credentialResetId: string): Promise<boolean> {
    const { count } = await (
      await this.db()
    ).credentialReset.updateMany({
      where: { credentialResetId, used: false },
      data: { used: true, usedAt: new Date() }
    });
    return count > 0;
  }

  /** Invalida los tokens activos del usuario; devuelve cuántos. */
  async invalidateUserTokens(userId: string): Promise<number> {
    return (
      await (
        await this.db()
      ).credentialReset.updateMany({ where: { userId, used: false }, data: { used: true, usedAt: new Date() } })
    ).count;
  }

  async create(data: { userId: string; token: string; email: string; type: ResetType; expiresAt: Date }): Promise<void> {
    await (await this.db()).credentialReset.create({
      data: { userId: data.userId, token: data.token, email: data.email, type: data.type, expiresAt: data.expiresAt, used: false }
    });
  }
}

