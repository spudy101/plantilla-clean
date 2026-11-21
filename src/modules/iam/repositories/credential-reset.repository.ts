// modules/schemas/kyc/iam/repositories/credential-reset.repository.ts
//
// Tokens de reset de contraseña / MFA. Flujo NO autenticado: origin_session_id queda null; la extensión
// de Prisma completa el correlationId del request.
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { Prisma, CredentialReset } from '../../../shared/database/generated/prisma/client';

const WITH_USER = {
  user: {
    select: {
      userId: true,
      authUsername: true,
      person: { select: { personId: true, firstName: true, contact: { select: { email: true } } } }
    }
  }
} satisfies Prisma.CredentialResetInclude;

export type ResetTokenWithUser = Prisma.CredentialResetGetPayload<{ include: typeof WITH_USER }>;

const valid = (token: string): Prisma.CredentialResetWhereInput => ({ token, used: false, expiresAt: { gt: new Date() } });

class CredentialResetRepository extends PrismaRepository {
  /** Token válido (no usado y no expirado). */
  async findValidToken(token: string): Promise<CredentialReset | null> {
    return (await this.db()).credentialReset.findFirst({ where: valid(token) });
  }

  /** Token válido con el usuario, su persona y el email de contacto (aplicar el reset y avisar). */
  async findValidTokenWithUser(token: string): Promise<ResetTokenWithUser | null> {
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

  async createResetToken(
    data: Pick<Prisma.CredentialResetUncheckedCreateInput, 'userId' | 'token' | 'email' | 'type' | 'expiresAt'>
  ) {
    return (await this.db()).credentialReset.create({
      data: { userId: data.userId, token: data.token, email: data.email, type: data.type, expiresAt: data.expiresAt, used: false }
    });
  }
}

export default new CredentialResetRepository();
