// modules/schemas/records/legal/repositories/privacy-policy.repository.ts
//
// Lectura pública de la política de privacidad (registro, login, mantenedores). La publicación de
// versiones vive en privacy-policy-admin.repository.
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { PrivacyPolicy } from '../../../shared/database/generated/prisma/client';

class PrivacyPolicyRepository extends PrismaRepository {
  /**
   * Retorna la versión activa actualmente.
   * Siempre debe existir una — si no hay ninguna es un error de configuración.
   */
  async findActive(): Promise<PrivacyPolicy | null> {
    return (await this.db()).privacyPolicy.findFirst({ where: { isActive: true } });
  }

  /** Busca una versión por su string de versión (ej: "1.0"). */
  async findByVersion(version: string): Promise<PrivacyPolicy | null> {
    return (await this.db()).privacyPolicy.findUnique({ where: { version } });
  }
}

export default new PrivacyPolicyRepository();
