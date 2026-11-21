// modules/shared-endpoints/kyc/iam/services/mfa/totp-mfa.service.ts
//
// Segundo factor TOTP (RFC 6238): configuración, activación, verificación y baja.
// Extraído de MFAService (SOLID: S).

import type { RequestAuditContext } from '../../../../shared/application/audit-context';
import unitOfWork from '../../../../shared/infrastructure/database/unit-of-work';
import userRepository from '../../repositories/user.repository';
import notificationModule from '../../../notification';
const { notifier } = notificationModule;
import TotpUtil from '../../../../shared/infrastructure/security/totp.util';
import EncryptionUtil from '../../../../shared/infrastructure/security/encryption.util';
import AppError from '../../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import mfaDtoModule from '../../responses/mfa.response';
const { TOTPSetupResponseDTO, TOTPActivationResponseDTO, TOTPVerificationResponseDTO } = mfaDtoModule;
import MfaAccount from './mfa-account';
import auditModule from '../../../audit';
const { audit } = auditModule;

const ENTITY = { entityType: 'User', entityTable: 'users' };

class TotpMfaService {
  unitOfWork: typeof unitOfWork;
  userRepository: typeof userRepository;
  notifier: typeof notifier;
  account: InstanceType<typeof MfaAccount>;

  /** @param {object} [deps] Dependencias inyectables (SOLID: D). Las provee la fachada MFAService. */
  constructor(deps: TotpMfaService.Deps = {}) {
    this.unitOfWork = deps.unitOfWork ?? unitOfWork;
    this.userRepository = deps.userRepository ?? userRepository;
    this.notifier = deps.notifier ?? notifier;
    this.account = deps.account ?? new MfaAccount(deps);
  }

  async setupTOTP(userId: string, username: string | null) {
    const user = await this.account.getUserSecure(userId);
    if (user.totpEnabled) {
      throw AppError.conflict('TOTP ya esta activado para este usuario');
    }

    // Generamos el secreto nosotros (RFC 6238) y lo persistimos CIFRADO. Aún no
    // se activa: totp_enabled sigue false hasta que verifyAndActivateTOTP valide
    // el primer código. Un re-setup antes de activar sobrescribe el secreto.
    const secretCode = TotpUtil.generateSecret();
    // Etiqueta en la app autenticadora: sin username (token viejo) quedaba literalmente 'null'
    const otpauthUrl = TotpUtil.keyuri(username ?? userId, secretCode);

    await this.userRepository.update(userId, { totpSecret: EncryptionUtil.encrypt(secretCode) });

    await audit.record('MFA_TOTP_SETUP', { actorId: userId, details: { username }, entityId: userId, ...ENTITY });

    return TOTPSetupResponseDTO({ otpauthUrl, secretCode, username });
  }

  async verifyAndActivateTOTP(totpCode: string, userId: string, username: string | null, firstName: string | null, auditContext: RequestAuditContext) {
    const user = await this.account.getUserSecure(userId);
    if (user.totpEnabled) {
      throw AppError.conflict('TOTP ya esta activado');
    }
    if (!user.totpSecret) {
      throw AppError.badRequest('Primero debes configurar TOTP');
    }

    // Verificar el código ANTES de abrir la transacción — no hay side effects externos que revertir.
    const secret = EncryptionUtil.decrypt(user.totpSecret);
    if (!TotpUtil.verify(totpCode, secret)) {
      throw AppError.badRequest('Codigo TOTP invalido');
    }

    await this.unitOfWork.run(async () => {
      await this.userRepository.updateTOTPStatus(userId, true);

      // Primer MFA activado → queda como método preferido para que el login lo aplique
      if (user.preferredMfaMethod === 'none') {
        await this.userRepository.update(userId, { preferredMfaMethod: 'totp' });
      }

      await this.account.recordChange({
        userId,
        changeType: 'mfa_status',
        previousValue: 'disabled',
        newValue: 'enabled',
        changeReason: 'MFA activado por cliente',
        auditContext
      });
    });

    // TOTP activado — crítico, modifica seguridad de la cuenta
    await audit.record('MFA_TOTP_ACTIVATED', {
      actorId: userId,
      details: { username },
      entityId: userId,
      ...ENTITY
    });
    this._notify('TOTP_ACTIVADO', userId, firstName);

    return TOTPActivationResponseDTO({ userId, username, totpEnabled: true });
  }

  async verifyTOTP(totpCode: string, userId: string, username: string | null) {
    const user = await this.account.getUserSecure(userId);
    if (!user.totpEnabled) {
      throw AppError.badRequest('TOTP no esta activado para este usuario');
    }

    const secret = EncryptionUtil.decrypt(user.totpSecret);
    const isValid = TotpUtil.verify(totpCode, secret);

    // Registrar verificación — exitosa o fallida
    await audit.record(isValid ? 'MFA_VERIFIED' : 'MFA_FAILED', {
      actorId: userId,
      details: { username, success: isValid },
      entityId: userId,
      ...ENTITY,
      outcome: isValid ? 'success' : 'failure'
    });

    return TOTPVerificationResponseDTO({ valid: isValid, username });
  }

  async deactivateTOTP(password: string, userId: string, username: string | null, firstName: string | null, auditContext: RequestAuditContext) {
    const user = await this.account.getUserSecure(userId);
    if (!user.totpEnabled) {
      throw AppError.badRequest('TOTP no esta activado');
    }

    const isPasswordValid = await this.userRepository.verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      throw AppError.unauthorized('Contrasena incorrecta');
    }

    await this.unitOfWork.run(async () => {
      // Limpia el flag y BORRA el secreto en un solo update.
      await this.userRepository.setTOTPStatus(userId, false, null);

      // Si TOTP era el método preferido, degradar para no dejar al login pidiendo
      // un factor que ya no existe: cae a SMS si está activo, si no a 'none'.
      if (user.preferredMfaMethod === 'totp') {
        await this.userRepository.update(userId, { preferredMfaMethod: user.smsMfaEnabled ? 'sms' : 'none' });
      }

      await this.account.recordChange({
        userId,
        changeType: 'mfa_status',
        previousValue: 'enabled',
        newValue: 'disabled',
        changeReason: 'MFA desactivado por cliente',
        auditContext
      });
    });

    // TOTP desactivado — crítico, reduce seguridad de la cuenta
    await audit.record('MFA_TOTP_DEACTIVATED', {
      actorId: userId,
      details: { username },
      entityId: userId,
      ...ENTITY
    });
    this._notify('TOTP_ELIMINADO', userId, firstName);

    return TOTPActivationResponseDTO({ userId, username, totpEnabled: false });
  }

  /** @private — notificación fire-and-forget al usuario */
  _notify(type: string, userId: string, firstName: string | null) {
    setImmediate(() => {
      this.notifier.notify({
        type,
        userId,
        relatedEntity: null,
        metadata: { nombre: firstName }
      }).catch(err => logger.warn(`Error enviando notificacion ${type}`, { error: err.message, userId }));
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace TotpMfaService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    unitOfWork?: typeof unitOfWork;
    userRepository?: typeof userRepository;
    notifier?: typeof notifier;
    account?: InstanceType<typeof MfaAccount>;
  }
}

export default TotpMfaService;
