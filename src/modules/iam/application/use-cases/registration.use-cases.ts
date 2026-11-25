// Casos de uso del portal cliente sin sesión: registrarse (RegisterClient, RF-AUTH-01) y recuperar credenciales
// por un enlace de un solo uso (RequestCredentialReset, ConfirmCredentialReset, RF-AUTH-02 CA-03).
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import rbacModule from '../../../../shared/domain/constants/rbac';
import {
  IamConflictError,
  IamForbiddenError,
  IamInternalError,
  IamInvalidInputError,
  IamNotFoundError,
  UserNotFoundError
} from '../../domain/errors';
import { MFA_RESET_CHANGES, resetLink, resetNotificationTypes, type CredentialResetWithUser, type ResetType } from '../../domain/credential-reset';
import authRegisterDtoModule from '../dto/auth-register.output';
import type { IamDeps } from './iam-deps';
import type { SessionIssuer } from './sessions';

const { errorMessage } = errorMessageModule;
const { RBAC_ROLES } = rbacModule;
const { RegisterResponseDTO } = authRegisterDtoModule;

// ============================================================
// REGISTRO
// ============================================================

/** Body de POST /auth/register. */
export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  secondLastName?: string | null;
  nationalId: string;
  documentTypeId: string;
  genderId?: string | null;
  birthDate?: string | null;
  comunicacionesComerciales?: boolean;
}

/** Lo que se persiste: el body + lo que resuelve el registro (país, handle, política). */
interface NewUserData extends Omit<RegisterInput, 'comunicacionesComerciales'> {
  countryId: string;
  authUsername: string;
  privacyPolicyVersion: string;
  privacyPolicyAcceptedAt: Date;
  privacyPolicyAcceptedIp: string | null;
  comunicacionesComerciales: boolean;
}

type RegisterDeps = Pick<
  IamDeps,
  | 'users'
  | 'roles'
  | 'holders'
  | 'catalogs'
  | 'privacyPolicies'
  | 'consents'
  | 'verificationCodes'
  | 'preferences'
  | 'passwords'
  | 'random'
  | 'errors'
  | 'unitOfWork'
  | 'audit'
  | 'notifier'
  | 'logger'
  | 'policy'
> & { sessionIssuer: SessionIssuer };

export class RegisterClient {
  constructor(private readonly deps: RegisterDeps) {}

  async execute(userData: RegisterInput, context: { ip?: string | null; userAgent?: string | null } = {}) {
    const { audit, verificationCodes, logger } = this.deps;
    const { email, password, firstName, middleName, lastName, secondLastName, nationalId, documentTypeId, genderId, birthDate, comunicacionesComerciales } =
      userData;

    const { colombia, privacyPolicyVersion, documentType } = await this.prerequisites(email, documentTypeId);
    await this.validate(email, nationalId, genderId);

    // Handle interno estable del usuario
    const authUsername = `user_${this.deps.random.uuid()}`;

    const dbResult = await this.createWithRollback({
      email,
      password,
      firstName,
      middleName,
      lastName,
      secondLastName,
      nationalId,
      documentTypeId: documentType.documentTypeId,
      genderId: genderId || null,
      countryId: colombia.countryId,
      authUsername,
      birthDate,
      // La política de privacidad, en el momento exacto del registro
      privacyPolicyVersion,
      privacyPolicyAcceptedAt: new Date(),
      privacyPolicyAcceptedIp: context?.ip || null,
      comunicacionesComerciales: comunicacionesComerciales === true
    });

    // [RF-AUTH-01] | CA-04 | Login automático post-registro. La 2FA es opt-in: el usuario la activa cuando quiere.
    const tokens = await this.issueAuthTokens(dbResult.user.userId, context);

    await audit.record('USER_REGISTERED', {
      actorId: dbResult.user.userId,
      details: { nationalId },
      entityId: dbResult.user.userId,
      entityType: 'User',
      entityTable: 'users'
    });

    setImmediate(() => {
      verificationCodes
        .consumeVerified('email', email)
        .catch(err => logger.warn('Error limpiando verification_code post-register', { error: err.message }));
    });

    this.sendWelcome(dbResult.user.userId, firstName, email);

    return RegisterResponseDTO({ ...dbResult, tokens });
  }

  /** País de operación, política activa, email verificado y tipo de documento permitido. */
  private async prerequisites(email: string, documentTypeId: string) {
    const { catalogs, privacyPolicies, verificationCodes } = this.deps;
    const [colombia, activePolicy] = await Promise.all([catalogs.countryByCode('COL'), privacyPolicies.findActive()]);
    if (!activePolicy) {
      throw new IamInternalError('No hay una política de privacidad activa configurada. Contacta al administrador.');
    }
    if (!colombia) {
      throw new IamInternalError('País de operación no configurado en BD. Contacta al administrador.');
    }

    // [RF-AUTH-01] | CA-02 | No se crea la cuenta sin email verificado (OTP previo al registro, TTL 15 min)
    if (!(await verificationCodes.isVerified('email', email))) {
      throw new IamForbiddenError('El email debe estar verificado antes de registrarse');
    }

    const documentType = await catalogs.documentType(documentTypeId);
    if (!documentType || !documentType.isActive) {
      throw new IamNotFoundError('Tipo de documento no encontrado');
    }
    if (!documentType.isVisibleToClient) {
      throw new IamForbiddenError('Tipo de documento no permitido para registro');
    }
    return { colombia, privacyPolicyVersion: activePolicy.version, documentType };
  }

  // [RF-AUTH-01] | CA-01 | Unicidad de documento y correo antes de crear el registro → 409
  private async validate(email: string, nationalId: string, genderId: string | null | undefined) {
    const { holders, catalogs } = this.deps;
    const [emailTaken, nationalIdTaken] = await Promise.all([holders.emailInUse(email), holders.nationalIdInUse(nationalId)]);
    if (emailTaken) {
      throw new IamConflictError('El email ya está registrado');
    }
    if (nationalIdTaken) {
      throw new IamConflictError('El número de documento ya está registrado');
    }
    if (genderId && !(await catalogs.genderExists(genderId))) {
      throw new IamNotFoundError('El género seleccionado no existe');
    }
  }

  private async createWithRollback(data: NewUserData) {
    try {
      return await this.create(data);
    } catch (error) {
      // La transacción ya revirtió cualquier escritura parcial; acá solo se traduce el error
      if (this.deps.errors.shouldPropagate(error)) {
        throw error;
      }
      const dbError = (error ?? {}) as { stack?: string; name?: string; sql?: string; fields?: unknown; parent?: { message?: string } };
      this.deps.logger.error('_createUserInDB failed - error original', {
        message: errorMessage(error),
        stack: dbError.stack,
        name: dbError.name,
        sql: dbError.sql ?? null,
        fields: dbError.fields ?? null,
        parent: dbError.parent?.message ?? null
      });
      throw new IamInternalError('Error al crear usuario. Intenta nuevamente');
    }
  }

  /**
   * Alta atómica: persona, contacto, usuario (rol CLIENTE), preferencia de notificación y consentimientos se confirman
   * juntos o no queda nada. La constancia del consentimiento es el entregable de habeas data: sin ella no hay cuenta.
   */
  private async create(data: NewUserData) {
    const { unitOfWork, preferences, logger } = this.deps;
    const result = await unitOfWork.run(async () => {
      const created = await this.createEntities(data);
      await preferences.createDefault(created.user.userId);
      await this.recordConsents(created.user.userId, data);
      return created;
    });
    logger.info('User created in DB', { userId: result.user.userId, roleId: result.role.roleId });
    return result;
  }

  private async createEntities(data: NewUserData) {
    const { roles, holders, users, passwords } = this.deps;
    const defaultRole = await roles.findByName(RBAC_ROLES.CLIENTE);
    if (!defaultRole) {
      throw new IamInternalError(`Rol ${RBAC_ROLES.CLIENTE} no encontrado en BD. Ejecuta el seeder RBAC.`);
    }

    const { person, contact: personContact } = await holders.create(
      {
        firstName: data.firstName,
        middleName: data.middleName,
        lastName: data.lastName,
        secondLastName: data.secondLastName,
        nationalId: data.nationalId,
        documentTypeId: data.documentTypeId,
        genderId: data.genderId || null,
        countryId: data.countryId || null,
        birthDate: data.birthDate
      },
      // [RF-AUTH-01] | CA-02 | Sella la verificación del correo al crear la cuenta
      { email: data.email, emailVerifiedAt: new Date() }
    );

    const user = await users.create({
      username: data.authUsername,
      authUsername: data.authUsername,
      passwordHash: await passwords.hash(data.password),
      personId: person.personId,
      roleId: defaultRole.roleId,
      privacyPolicyVersion: data.privacyPolicyVersion,
      privacyPolicyAcceptedAt: data.privacyPolicyAcceptedAt,
      privacyPolicyAcceptedIp: data.privacyPolicyAcceptedIp
    });

    return { user, person, personContact, role: defaultRole };
  }

  /**
   * [RF-AUTH-01] | CA-01 | PRIVACY_POLICY (obligatorio) y COMUNICACIONES_COMERCIALES (opcional) en user_consents.
   * Dentro de la transacción del alta: si falla, el registro se revierte. El único hecho auditado es USER_REGISTERED.
   */
  private async recordConsents(userId: string, data: Pick<NewUserData, 'privacyPolicyVersion' | 'privacyPolicyAcceptedIp' | 'comunicacionesComerciales'>) {
    const { consents, logger } = this.deps;
    const privacy = await consents.grantPrivacyPolicy({ userId, ip: data.privacyPolicyAcceptedIp });
    if (privacy) {
      logger.info('Consentimiento de política de privacidad otorgado en registro', {
        userId,
        policyVersion: data.privacyPolicyVersion,
        userConsentId: privacy?.userConsentId
      });
    }
    if (data.comunicacionesComerciales) {
      const commercial = await consents.grantCommercialCommunications({ userId, ip: data.privacyPolicyAcceptedIp });
      if (commercial) {
        logger.info('Consentimiento de comunicaciones comerciales otorgado en registro', { userId, userConsentId: commercial?.userConsentId });
      }
    }
  }

  /** Recarga el usuario con rol y persona para que el access token lleve todos los claims. */
  private async issueAuthTokens(userId: string, context: { ip?: string | null; userAgent?: string | null } = {}) {
    const user = await this.deps.users.findLoginUser(userId);
    if (!user) {
      throw new IamInternalError('Usuario recién creado no encontrado');
    }
    const { tokens } = await this.deps.sessionIssuer.issue(user, { ip: context?.ip, userAgent: context?.userAgent, source: 'registro' });
    return tokens;
  }

  private sendWelcome(userId: string, nombre: string, email: string) {
    const { notifier, logger, policy } = this.deps;
    setImmediate(() => {
      notifier
        .notify({ type: 'BIENVENIDA', userId, relatedEntity: null, metadata: { nombre, email, logoUrl: policy.notificationLogoUrl } })
        .catch(err => logger.warn('Error sending welcome notification', { error: err.message, userId }));
    });
  }
}

// ============================================================
// RESET DE CREDENCIALES
// ============================================================

const RESET_TOKEN_BYTES = 32;
const MS_PER_MINUTE = 60 * 1000;

type ResetDeps = Pick<
  IamDeps,
  'users' | 'holders' | 'credentialResets' | 'sessions' | 'revocations' | 'changeLog' | 'passwords' | 'random' | 'unitOfWork' | 'audit' | 'notifier' | 'logger' | 'policy'
>;

// [RF-AUTH-02] | CA-03 | Token de un solo uso (15 min) por email. Anti-enumeración: siempre responde igual.
export class RequestCredentialReset {
  constructor(private readonly deps: ResetDeps) {}

  async execute({ email, type }: { email: string; type: ResetType }): Promise<boolean> {
    const { holders, users, credentialResets, random, audit, notifier, logger, policy } = this.deps;

    const holder = await holders.findByEmail(email);
    const user = holder ? await users.findByPersonId(holder.personId) : null;
    if (!holder || !user) {
      logger.info('Reset requested for non-existent email', { type });
      return false;
    }
    if (!user.isActive) {
      logger.info('Reset requested for inactive user', { type });
      return false;
    }

    const invalidated = await credentialResets.invalidateUserTokens(user.userId);
    if (invalidated > 0) {
      logger.info('Previous reset tokens invalidated', { userId: user.userId, count: invalidated, type });
    }

    const token = random.hex(RESET_TOKEN_BYTES);
    const expiresAt = new Date(Date.now() + policy.resetTokenMinutes * MS_PER_MINUTE);
    await credentialResets.create({ userId: user.userId, email, token, type, expiresAt });

    await audit.record('CREDENTIALS_RESET_REQUESTED', {
      actorId: user.userId,
      details: { type },
      entityId: user.userId,
      entityType: 'User',
      entityTable: 'users'
    });

    const firstName = holder.firstName || 'Usuario';
    const enlace = resetLink(policy.resetCredentialUrl, type, token);
    setImmediate(() => {
      notifier
        .notifyEmail({
          type: resetNotificationTypes(type).request,
          email,
          metadata: { nombre: firstName, email, enlace, minutosExpiracion: policy.resetTokenMinutes, logoUrl: policy.notificationLogoUrl }
        })
        .catch(err => logger.warn('Error sending reset notification', { error: err.message }));
    });

    logger.info('Reset credentials requested', { userId: user.userId, type });
    return true;
  }
}

// [RF-AUTH-02] | CA-03 | Valida el token, aplica el reset, lo marca usado e invalida todas las sesiones
export class ConfirmCredentialReset {
  constructor(private readonly deps: ResetDeps) {}

  async execute({ token, newPassword, type }: { token: string; newPassword?: string; type: ResetType }): Promise<null> {
    const { credentialResets, unitOfWork, audit } = this.deps;
    const resetRecord = await credentialResets.findValidWithUser(token);
    if (!resetRecord) {
      throw new IamInvalidInputError('Token inválido o expirado');
    }
    if (resetRecord.type !== type) {
      throw new IamInvalidInputError('Tipo de reset incorrecto');
    }
    const { user } = resetRecord;
    if (!user) {
      throw new UserNotFoundError();
    }

    const notificationType = await unitOfWork.run(async () => {
      // Se consume primero y solo si sigue sin usar: dos requests con el mismo token no aplican el reset dos veces
      if (!(await credentialResets.markAsUsed(resetRecord.credentialResetId))) {
        throw new IamInvalidInputError('Token inválido o expirado');
      }
      return this.apply(type, user, newPassword);
    });

    await audit.record(resetNotificationTypes(type).audit, {
      actorId: user.userId,
      details: { type },
      entityId: user.userId,
      entityType: 'User',
      entityTable: 'users'
    });
    this.notifyConfirmed(user, notificationType);
    if (type === 'password') {
      this.invalidateSessions(user.userId);
    }
    return null;
  }

  private async apply(type: ResetType, user: CredentialResetWithUser['user'], newPassword: string | undefined) {
    const { users, passwords, changeLog } = this.deps;
    if (type === 'password') {
      if (!newPassword) {
        throw new IamInvalidInputError('La nueva contraseña es requerida');
      }
      await users.update(user.userId, { passwordHash: await passwords.hash(newPassword) });
      return 'RESET_PASSWORD';
    }
    if (type === 'mfa') {
      // Reset total del MFA: baja TOTP (y borra su secreto) y SMS
      await users.update(user.userId, { totpEnabled: false, totpSecret: null, smsMfaEnabled: false, preferredMfaMethod: 'none' });
      for (const changeType of MFA_RESET_CHANGES) {
        await changeLog.record({
          userId: user.userId,
          changedByUserId: null,
          changedByRole: 'system',
          changeType,
          previousValue: 'enabled',
          newValue: 'disabled',
          changeReason: 'Reset de MFA por pérdida de dispositivo'
        });
      }
      return 'RESET_MFA';
    }
    throw new IamInvalidInputError('Tipo de reset no soportado');
  }

  private invalidateSessions(userId: string) {
    const { revocations, sessions, logger } = this.deps;
    revocations
      .invalidateUserSessions(userId)
      .catch(err => logger.warn('Error invalidando sesiones en Redis tras reset de contraseña', { error: err.message, userId }));
    sessions
      .closeAllByUser(userId, 'password_reset')
      .catch(err => logger.warn('Error cerrando sesiones en BD tras reset de contraseña', { error: err.message, userId }));
  }

  private notifyConfirmed(user: CredentialResetWithUser['user'], type: string) {
    const { notifier, logger, policy } = this.deps;
    const firstName = user.person?.firstName || 'Usuario';
    const email = user.person?.contact?.email;
    setImmediate(() => {
      notifier
        .notify({ type, userId: user.userId, relatedEntity: null, metadata: { nombre: firstName, email, logoUrl: policy.notificationLogoUrl } })
        .catch(err => logger.warn('Error sending reset confirmation notification', { error: err.message, userId: user.userId }));
    });
  }
}
