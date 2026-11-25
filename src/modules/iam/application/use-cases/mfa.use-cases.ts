// Casos de uso del segundo factor del propio usuario: TOTP (RFC 6238) y SMS, más lo transversal a ambos (estado,
// método preferido, validar la contraseña). La preferencia de MFA vive en nuestra base: el login la lee para decidir
// qué segundo factor exigir.
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import {
  IamConflictError,
  IamForbiddenError,
  IamInvalidInputError,
  IamNotFoundError,
  IamRateLimitedError,
  IamUnauthorizedError,
  UserNotFoundError
} from '../../domain/errors';
import {
  preferredAfterDisablingSms,
  preferredAfterDisablingTotp,
  preferredAfterEnabling,
  truncatedCode
} from '../../domain/mfa';
import type { UserAccount, UserChanges } from '../../domain/user';
import mfaDtoModule from '../dto/mfa.output';
import type { AccountChangeType } from '../ports/module-sources.port';
import type { IamDeps } from './iam-deps';

const { errorMessage } = errorMessageModule;
const {
  PasswordValidationResponseDTO,
  MFAStatusResponseDTO,
  PreferredMethodResponseDTO,
  TOTPSetupResponseDTO,
  TOTPActivationResponseDTO,
  TOTPVerificationResponseDTO,
  SMSMFAActivationResponseDTO,
  SMSActivationRequestResponseDTO
} = mfaDtoModule;

const ENTITY = { entityType: 'User', entityTable: 'users' };

/** Quién pide la operación: su cuenta y cómo mostrarlo en las respuestas y avisos. */
export interface MfaActor {
  userId: string;
  username: string | null;
  firstName?: string | null;
}

/** Lecturas y bitácora compartidas por los casos de uso de MFA. */
export class MfaAccount {
  constructor(private readonly deps: Pick<IamDeps, 'users' | 'passwords' | 'changeLog' | 'notifier' | 'logger'>) {}

  /** La cuenta con sus columnas de seguridad (hash, flags y secreto MFA). */
  async getUserSecure(userId: string): Promise<UserAccount> {
    const user = await this.deps.users.findById(userId);
    if (!user) {
      throw new UserNotFoundError();
    }
    return user;
  }

  async getUserWithPhone(userId: string) {
    const user = await this.deps.users.findWithPrimaryPhone(userId);
    if (!user) {
      throw new UserNotFoundError();
    }
    return user;
  }

  /** La contraseña actual o 401 (`message`: el texto de cada flujo). */
  async assertPassword(user: Pick<UserAccount, 'passwordHash'>, password: string, message = 'Contraseña incorrecta') {
    if (!(await this.deps.passwords.matches(password, user.passwordHash))) {
      throw new IamUnauthorizedError(message);
    }
  }

  /** Un cambio de MFA hecho por el propio usuario, en la bitácora. */
  recordChange(userId: string, changeType: AccountChangeType, previousValue: string | null, newValue: string | null, changeReason: string) {
    return this.deps.changeLog.record({ userId, changedByUserId: userId, changedByRole: 'user', changeType, previousValue, newValue, changeReason });
  }

  /** Aviso al usuario (fire-and-forget). */
  notify(type: string, userId: string, firstName: string | null | undefined) {
    const { notifier, logger } = this.deps;
    setImmediate(() => {
      notifier
        .notify({ type, userId, relatedEntity: null, metadata: { nombre: firstName } })
        .catch(err => logger.warn(`Error enviando notificacion ${type}`, { error: err.message, userId }));
    });
  }
}

type MfaDeps = Pick<IamDeps, 'users' | 'passwords' | 'unitOfWork' | 'audit'> & { account: MfaAccount };
type TotpDeps = MfaDeps & Pick<IamDeps, 'totp' | 'cipher'>;
type SmsDeps = MfaDeps & Pick<IamDeps, 'verificationCodes' | 'sms' | 'random' | 'logger' | 'policy'>;

// ============================================================
// TRANSVERSAL
// ============================================================

export class ValidateMfaPassword {
  constructor(private readonly deps: MfaDeps) {}

  async execute({ userId, username }: MfaActor, password: string) {
    const user = await this.deps.account.getUserSecure(userId);
    const isValid = await this.deps.passwords.matches(password, user.passwordHash);
    await this.deps.audit.record('MFA_PASSWORD_VALIDATED', {
      actorId: userId,
      details: { username, success: isValid },
      entityId: userId,
      ...ENTITY,
      outcome: isValid ? 'success' : 'failure'
    });
    return PasswordValidationResponseDTO({ valid: isValid, username });
  }
}

export class GetMfaStatus {
  constructor(private readonly deps: MfaDeps) {}

  async execute({ userId, username }: MfaActor) {
    const user = await this.deps.account.getUserSecure(userId);
    await this.deps.audit.record('MFA_STATUS_VIEWED', { actorId: userId, details: { username }, entityId: userId, ...ENTITY });
    return MFAStatusResponseDTO({
      userId: user.userId,
      username,
      totpEnabled: user.totpEnabled ?? false,
      smsMfaEnabled: user.smsMfaEnabled ?? false,
      preferredMfaMethod: user.preferredMfaMethod ?? 'none'
    });
  }
}

export class UpdatePreferredMfaMethod {
  constructor(private readonly deps: MfaDeps) {}

  async execute({ userId, username }: MfaActor, preferredMethod: string) {
    const { account, users, unitOfWork, audit } = this.deps;
    const user = await account.getUserSecure(userId);
    if (preferredMethod === 'totp' && !user.totpEnabled) {
      throw new IamInvalidInputError('Debes activar TOTP antes de seleccionarlo como método preferido');
    }
    if (preferredMethod === 'sms' && !user.smsMfaEnabled) {
      throw new IamInvalidInputError('Debes activar SMS MFA antes de seleccionarlo como método preferido');
    }

    await unitOfWork.run(async () => {
      await users.update(userId, { preferredMfaMethod: preferredMethod });
      await account.recordChange(userId, 'preferred_mfa_method', user.preferredMfaMethod, preferredMethod, 'Método MFA preferido actualizado por cliente');
    });

    await audit.record('MFA_PREFERRED_METHOD_UPDATED', { actorId: userId, details: { username, preferredMethod }, entityId: userId, ...ENTITY });
    return PreferredMethodResponseDTO({ userId, username, preferredMfaMethod: preferredMethod });
  }
}

// ============================================================
// TOTP
// ============================================================

export class SetupTotp {
  constructor(private readonly deps: TotpDeps) {}

  async execute({ userId, username }: MfaActor) {
    const { account, totp, cipher, users, audit } = this.deps;
    const user = await account.getUserSecure(userId);
    if (user.totpEnabled) {
      throw new IamConflictError('TOTP ya esta activado para este usuario');
    }

    // El secreto se guarda CIFRADO pero todavía no se activa: totp_enabled sigue false hasta que se valide el
    // primer código. Un re-setup antes de activar sobrescribe el secreto.
    const secretCode = totp.generateSecret();
    // Etiqueta en la app autenticadora: sin username (token viejo) quedaba literalmente 'null'
    const otpauthUrl = totp.keyuri(username ?? userId, secretCode);
    await users.update(userId, { totpSecret: cipher.encrypt(secretCode) });

    await audit.record('MFA_TOTP_SETUP', { actorId: userId, details: { username }, entityId: userId, ...ENTITY });
    return TOTPSetupResponseDTO({ otpauthUrl, secretCode, username });
  }
}

export class ActivateTotp {
  constructor(private readonly deps: TotpDeps) {}

  async execute({ userId, username, firstName }: MfaActor, totpCode: string) {
    const { account, totp, cipher, users, unitOfWork, audit } = this.deps;
    const user = await account.getUserSecure(userId);
    if (user.totpEnabled) {
      throw new IamConflictError('TOTP ya esta activado');
    }
    if (!user.totpSecret) {
      throw new IamInvalidInputError('Primero debes configurar TOTP');
    }
    // El código se verifica ANTES de abrir la transacción: no hay efectos externos que revertir
    if (!totp.verify(totpCode, cipher.decrypt(user.totpSecret))) {
      throw new IamInvalidInputError('Codigo TOTP invalido');
    }

    await unitOfWork.run(async () => {
      if (!(await users.update(userId, { totpEnabled: true }))) {
        throw new UserNotFoundError();
      }
      // El primer factor activado queda como preferido para que el login lo aplique
      const preferred = preferredAfterEnabling(user, 'totp');
      if (preferred) {
        await users.update(userId, { preferredMfaMethod: preferred });
      }
      await account.recordChange(userId, 'mfa_status', 'disabled', 'enabled', 'MFA activado por cliente');
    });

    await audit.record('MFA_TOTP_ACTIVATED', { actorId: userId, details: { username }, entityId: userId, ...ENTITY });
    account.notify('TOTP_ACTIVADO', userId, firstName);
    return TOTPActivationResponseDTO({ userId, username, totpEnabled: true });
  }
}

export class VerifyTotp {
  constructor(private readonly deps: TotpDeps) {}

  async execute({ userId, username }: MfaActor, totpCode: string) {
    const { account, totp, cipher, audit } = this.deps;
    const user = await account.getUserSecure(userId);
    if (!user.totpEnabled) {
      throw new IamInvalidInputError('TOTP no esta activado para este usuario');
    }
    const isValid = totp.verify(totpCode, user.totpSecret ? cipher.decrypt(user.totpSecret) : user.totpSecret);
    await audit.record(isValid ? 'MFA_VERIFIED' : 'MFA_FAILED', {
      actorId: userId,
      details: { username, success: isValid },
      entityId: userId,
      ...ENTITY,
      outcome: isValid ? 'success' : 'failure'
    });
    return TOTPVerificationResponseDTO({ valid: isValid, username });
  }
}

export class DeactivateTotp {
  constructor(private readonly deps: TotpDeps) {}

  async execute({ userId, username, firstName }: MfaActor, password: string) {
    const { account, users, unitOfWork, audit } = this.deps;
    const user = await account.getUserSecure(userId);
    if (!user.totpEnabled) {
      throw new IamInvalidInputError('TOTP no esta activado');
    }
    await account.assertPassword(user, password, 'Contrasena incorrecta');

    await unitOfWork.run(async () => {
      // Apaga el flag y BORRA el secreto en un solo update
      await users.update(userId, { totpEnabled: false, totpSecret: null });
      const preferred = preferredAfterDisablingTotp(user);
      if (preferred) {
        await users.update(userId, { preferredMfaMethod: preferred });
      }
      await account.recordChange(userId, 'mfa_status', 'enabled', 'disabled', 'MFA desactivado por cliente');
    });

    await audit.record('MFA_TOTP_DEACTIVATED', { actorId: userId, details: { username }, entityId: userId, ...ENTITY });
    account.notify('TOTP_ELIMINADO', userId, firstName);
    return TOTPActivationResponseDTO({ userId, username, totpEnabled: false });
  }
}

// ============================================================
// SMS
// ============================================================

const OTP_EXPIRATION_MINUTES = 15;
const MAX_OTP_ATTEMPTS = 5;
const OTP_CODE_MIN = 100000;
const OTP_CODE_MAX = 999999;
const MS_PER_MINUTE = 60 * 1000;

function requirePhone(user: { person?: { contact?: { phonePrimary?: string | null } | null } | null }) {
  const phone = user.person?.contact?.phonePrimary;
  if (!phone) {
    throw new IamInvalidInputError('Debes registrar un número de teléfono antes de activar SMS MFA');
  }
  return phone;
}

export class RequestSmsMfaActivation {
  constructor(private readonly deps: SmsDeps) {}

  async execute({ userId, username }: MfaActor, password: string) {
    const { account, verificationCodes, audit } = this.deps;
    const user = await account.getUserWithPhone(userId);
    if (user.smsMfaEnabled) {
      throw new IamConflictError('SMS MFA ya está activado para este usuario');
    }
    await account.assertPassword(user, password);
    const phone = requirePhone(user);

    const waitSeconds = await verificationCodes.secondsUntilNewCode('phone', phone);
    if (waitSeconds > 0) {
      throw new IamRateLimitedError(`Debes esperar ${waitSeconds} segundos antes de solicitar un nuevo código`, waitSeconds);
    }

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + OTP_EXPIRATION_MINUTES * MS_PER_MINUTE);
    const verificationCode = await verificationCodes.create({ type: 'phone', contactValue: phone, code, expiresAt });

    this.sendActivationSms(userId, phone, user.person?.contact?.phonePrimaryPrefixId ?? null, code);

    await audit.record('MFA_SMS_SETUP', { actorId: userId, details: { username }, entityId: userId, ...ENTITY });
    return SMSActivationRequestResponseDTO({ verificationCodeId: verificationCode.verificationCodeId, expiresAt, truncatedCode: truncatedCode(code) });
  }

  /** SMS en segundo plano: no bloquea la respuesta. */
  private sendActivationSms(userId: string, phone: string, phonePrefixId: string | null, code: string) {
    const { sms, logger } = this.deps;
    setImmediate(async () => {
      try {
        const phoneNumber = await sms.resolveE164(phone, phonePrefixId);
        const result = await sms.send({
          phoneNumber,
          message: `Tu código de activación de SMS MFA es ${code}. Vence en ${OTP_EXPIRATION_MINUTES} minutos.`,
          userId,
          purpose: 'mfa_setup'
        });
        if (!result.success) {
          logger.warn('SMS MFA activation code no enviado', { userId, error: result.error });
        }
      } catch (err) {
        logger.warn('Error enviando SMS MFA activation code', { userId, error: errorMessage(err) });
      }
    });
  }

  private generateCode() {
    if (this.deps.policy.mockOtpCodes) {
      return '123456';
    }
    return this.deps.random.int(OTP_CODE_MIN, OTP_CODE_MAX).toString();
  }
}

export class ConfirmSmsMfaActivation {
  constructor(private readonly deps: SmsDeps) {}

  async execute({ userId, username, firstName }: MfaActor, code: string) {
    const { account, verificationCodes, users, unitOfWork, audit } = this.deps;
    const user = await account.getUserWithPhone(userId);
    if (user.smsMfaEnabled) {
      throw new IamConflictError('SMS MFA ya está activado');
    }
    const phone = requirePhone(user);
    const verificationCode = await this.assertValidCode(phone, code);

    await unitOfWork.run(async () => {
      await verificationCodes.markAsVerified(verificationCode.verificationCodeId);
      const updates: UserChanges = { smsMfaEnabled: true };
      // El primer factor activado queda como preferido para que el login dispare el SMS
      const preferred = preferredAfterEnabling(user, 'sms');
      if (preferred) {
        updates.preferredMfaMethod = preferred;
      }
      await users.update(userId, updates);
      await account.recordChange(userId, 'sms_mfa_status', 'disabled', 'enabled', 'SMS MFA activado por cliente');
    });

    await audit.record('MFA_SMS_ACTIVATED', { actorId: userId, details: { username }, entityId: userId, ...ENTITY });
    account.notify('SMS_MFA_ACTIVADO', userId, firstName);
    return SMSMFAActivationResponseDTO({ userId, username, smsMfaEnabled: true });
  }

  /** El código vigente del teléfono: existencia, uso, intentos y valor. */
  private async assertValidCode(phone: string, code: string) {
    const { verificationCodes } = this.deps;
    const verificationCode = await verificationCodes.findActive('phone', phone);
    if (!verificationCode) {
      throw new IamNotFoundError('Código de verificación no encontrado o expirado');
    }
    if (verificationCode.verifiedAt) {
      throw new IamInvalidInputError('Este código ya fue utilizado');
    }
    const attempts = verificationCode.attempts ?? 0;
    if (attempts >= MAX_OTP_ATTEMPTS) {
      throw new IamForbiddenError('Excediste el número máximo de intentos. Solicita un nuevo código');
    }
    if (verificationCode.code !== code) {
      await verificationCodes.incrementAttempts(verificationCode.verificationCodeId);
      const remaining = MAX_OTP_ATTEMPTS - (attempts + 1);
      throw new IamInvalidInputError(`Código inválido. Te quedan ${remaining} intento${remaining !== 1 ? 's' : ''}`);
    }
    return verificationCode;
  }
}

export class DeactivateSmsMfa {
  constructor(private readonly deps: SmsDeps) {}

  async execute({ userId, username, firstName }: MfaActor, password: string) {
    const { account, users, unitOfWork, audit } = this.deps;
    const user = await account.getUserSecure(userId);
    if (!user.smsMfaEnabled) {
      throw new IamInvalidInputError('SMS MFA no está activado');
    }
    await account.assertPassword(user, password);

    await unitOfWork.run(async () => {
      const updates: UserChanges = { smsMfaEnabled: false };
      const preferred = preferredAfterDisablingSms(user);
      if (preferred) {
        updates.preferredMfaMethod = preferred;
      }
      await users.update(userId, updates);
      await account.recordChange(userId, 'sms_mfa_status', 'enabled', 'disabled', 'SMS MFA desactivado por cliente');
    });

    await audit.record('MFA_SMS_DEACTIVATED', { actorId: userId, details: { username }, entityId: userId, ...ENTITY });
    account.notify('SMS_MFA_DESACTIVADO', userId, firstName);
    return SMSMFAActivationResponseDTO({ userId, username, smsMfaEnabled: false });
  }
}
