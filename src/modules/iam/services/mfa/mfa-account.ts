import type { User } from '../../../../shared/database/generated/prisma/client';
import type { ChangeType } from '../../../audit';
import type { RequestAuditContext } from '../../../../shared/types/audit-context';
// modules/shared-endpoints/kyc/iam/services/mfa/mfa-account.ts
//
// Lecturas y bitácora compartidas por los servicios de MFA (TOTP, SMS y la fachada).
// Extraído de MFAService (SOLID: S).

import userRepository from '../../repositories/user.repository';
import personModule from '../../../person';
const { KycSharedUtil } = personModule;
import AppError from '../../../../shared/http/app-error.util';

class MfaAccount {
  userRepository: typeof userRepository;
  kycSharedUtil: typeof KycSharedUtil;

  /** @param {object} [deps] Dependencias inyectables (SOLID: D). */
  constructor(deps: MfaAccount.Deps = {}) {
    this.userRepository = deps.userRepository ?? userRepository;
    this.kycSharedUtil = deps.kycSharedUtil ?? KycSharedUtil;
  }

  /** Usuario con columnas de seguridad (hash, flags y secreto MFA), sin asociaciones. */
  async getUserSecure(userId: string) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw AppError.notFound('Usuario no encontrado');
    }
    return user;
  }

  /** Usuario con su teléfono principal (para el SMS MFA). */
  async getUserWithPhone(userId: string) {
    const user = await this.userRepository.findWithPrimaryPhone(userId);
    if (!user) {
      throw AppError.notFound('Usuario no encontrado');
    }
    return user;
  }

  /** Verifica la contraseña actual o lanza 401. */
  async assertPassword(user: Pick<User, 'passwordHash'>, password: string) {
    const isPasswordValid = await this.userRepository.verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      throw AppError.unauthorized('Contraseña incorrecta');
    }
  }

  /** Registra en user_change_logs un cambio de MFA hecho por el propio usuario. */
  recordChange({
    userId,
    changeType,
    previousValue,
    newValue,
    changeReason,
    auditContext
  }: {
    userId: string;
    changeType: ChangeType;
    previousValue: string | null;
    newValue: string | null;
    changeReason: string;
    auditContext: RequestAuditContext;
  }) {
    return this.kycSharedUtil.logChange({
      userId,
      changedByUserId: userId,
      changedByRole: 'user',
      changeType,
      previousValue,
      newValue,
      changeReason,
      ipAddress: auditContext.ip,
      userAgent: auditContext.userAgent
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace MfaAccount {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userRepository?: typeof userRepository;
    kycSharedUtil?: typeof KycSharedUtil;
  }
}

export default MfaAccount;
