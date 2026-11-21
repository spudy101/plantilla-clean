import type { RequestAuditContext } from '../../../shared/types/audit-context';
import { v4 as uuidv4 } from 'uuid';
import userRepository from '../repositories/user.repository';
import personModule from '../../person';
const { personRepository, personContactRepository } = personModule;
import catalogsModule from '../../catalogs';
const { documentTypeRepository, countryRepository, genderRepository } = catalogsModule;
// eslint-disable-next-line max-len
import notificationModule from '../../notification';
const { notificationPreferenceRepository: userNotificationPreferenceRepository, verificationCodeRepository, notifier } = notificationModule;
import legalModule from '../../legal';
const { privacyPolicyRepository, consentRecorder } = legalModule;
import roleRepository from '../repositories/role.repository';
import userSessionRepository from '../repositories/user-session.repository';
import AppError from '../../../shared/http/app-error.util';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import unitOfWork from '../../../shared/database/unit-of-work';
import CredentialResetService from './auth-register/credential-reset.service';
import SessionIssuerService from './auth-login/session-issuer.service';
import authRegisterDtoModule from '../responses/auth-register.response';
const { RegisterResponseDTO } = authRegisterDtoModule;
import constantsModule from '../../../shared/constants';
const { RBAC_ROLES, notifications } = constantsModule;
import errorMessageModule from '../../../shared/utils/error-message.util';

const { errorMessage } = errorMessageModule;
import { shouldPropagate } from '../../../shared/http/error-propagation';
import auditModule from '../../audit';
const { audit } = auditModule;


// === RF-AUTH-01: Registro de Usuario (confirmación de correo y celular) ===

class AuthRegisterService {
  unitOfWork: typeof unitOfWork;
  userRepository: typeof userRepository;
  personRepository: typeof personRepository;
  personContactRepository: typeof personContactRepository;
  documentTypeRepository: typeof documentTypeRepository;
  userNotificationPreferenceRepository: typeof userNotificationPreferenceRepository;
  countryRepository: typeof countryRepository;
  privacyPolicyRepository: typeof privacyPolicyRepository;
  consentRecorder: typeof consentRecorder;
  genderRepository: typeof genderRepository;
  verificationCodeRepository: typeof verificationCodeRepository;
  roleRepository: typeof roleRepository;
  userSessionRepository: typeof userSessionRepository;
  notifier: typeof notifier;
  sessionIssuer: InstanceType<typeof SessionIssuerService>;
  credentialReset: InstanceType<typeof CredentialResetService>;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new AuthRegisterService({ unitOfWork: fake })
   * @param {object} [deps]
   */
  constructor(deps: AuthRegisterService.Deps = {}) {
    this.unitOfWork = deps.unitOfWork ?? unitOfWork;
    this.userRepository = deps.userRepository ?? userRepository;
    this.personRepository = deps.personRepository ?? personRepository;
    this.personContactRepository = deps.personContactRepository ?? personContactRepository;
    this.documentTypeRepository = deps.documentTypeRepository ?? documentTypeRepository;
    this.userNotificationPreferenceRepository = deps.userNotificationPreferenceRepository ?? userNotificationPreferenceRepository;
    this.countryRepository = deps.countryRepository ?? countryRepository;
    this.privacyPolicyRepository = deps.privacyPolicyRepository ?? privacyPolicyRepository;
    this.consentRecorder = deps.consentRecorder ?? consentRecorder;
    this.genderRepository = deps.genderRepository ?? genderRepository;
    this.verificationCodeRepository = deps.verificationCodeRepository ?? verificationCodeRepository;
    this.roleRepository = deps.roleRepository ?? roleRepository;
    this.userSessionRepository = deps.userSessionRepository ?? userSessionRepository;
    this.notifier = deps.notifier ?? notifier;

    // Sub-servicios por responsabilidad (SOLID: S). Reciben las mismas dependencias compartidas.
    this.sessionIssuer =
      deps.sessionIssuer ?? new SessionIssuerService({ userSessionRepository: this.userSessionRepository });
    this.credentialReset =
      deps.credentialReset ??
      new CredentialResetService({
        unitOfWork: this.unitOfWork,
        userRepository: this.userRepository,
        personContactRepository: this.personContactRepository,
        userSessionRepository: this.userSessionRepository,
        notifier: this.notifier
      });
  }

  // ============================================================
  // REGISTER
  // ============================================================

  async register(userData: AuthRegisterService.RegisterInput, auditContext: Pick<RequestAuditContext, 'ip' | 'userAgent'> = {}) {
    const {
      email,
      password,
      firstName,
      middleName,
      lastName,
      secondLastName,
      nationalId,
      documentTypeId,
      genderId,
      birthDate,
      comunicacionesComerciales
    } = userData;

    const { colombia, privacyPolicyVersion, documentType } = await this._fetchRegistrationPrerequisites(email, documentTypeId);

    await this._validateRegistration(email, nationalId, genderId);

    // Handle interno estable del usuario (antes era el username de Cognito).
    const authUsername = `user_${uuidv4()}`;

    const dbResult = await this._createUserInDBWithRollback({
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
      // Política de privacidad — capturar en el momento exacto del registro
      privacyPolicyVersion,
      privacyPolicyAcceptedAt: new Date(),
      privacyPolicyAcceptedIp: auditContext?.ip || null,
      comunicacionesComerciales: comunicacionesComerciales === true
    });

    // [RF-AUTH-01] | CA-04 | Login automático post-registro. La 2FA es opt-in en el template base:
    // el usuario la activa cuando quiere desde /kyc/iam/mfa (TOTP o SMS); no se fuerza enrolamiento.
    // Un proyecto derivado que la quiera obligatoria puede gatear el acceso al dashboard aquí.
    // Los tokens de autorización los emite nuestro propio sistema (RS256).
    const tokens = await this._issueAuthTokens(dbResult.user.userId, auditContext);

    await audit.record('USER_REGISTERED', {
      actorId: dbResult.user.userId,
      details: { nationalId },
      entityId: dbResult.user.userId,
      entityType: 'User',
      entityTable: 'users'
    });

    setImmediate(() => {
      this.verificationCodeRepository
        .deleteVerifiedByContact('email', email)
        .catch(err => logger.warn('Error limpiando verification_code post-register', { error: err.message }));
    });

    this._sendWelcomeNotification(dbResult.user.userId, firstName, email);

    return RegisterResponseDTO({ ...dbResult, tokens });
  }

  /** @private — valida prerequisitos de registro: país, política activa, email verificado y tipo de documento */
  async _fetchRegistrationPrerequisites(email: string, documentTypeId: string) {
    const [colombia, activePolicy] = await Promise.all([
      this.countryRepository.findByCode('COL'),
      this.privacyPolicyRepository.findActive()
    ]);

    if (!activePolicy) {
      throw AppError.internal('No hay una política de privacidad activa configurada. Contacta al administrador.');
    }
    if (!colombia) {
      throw AppError.internal('País de operación no configurado en BD. Contacta al administrador.');
    }

    // [RF-AUTH-01] | CA-02 | 🔄 MODIFICADO: el criterio
    // describe enlace de activación post-registro con TTL 24h.
    // Implementado como OTP previo al registro (TTL 15 min).
    // Efecto equivalente: no se crea la cuenta sin email
    // verificado. TTL reducido por criterio de seguridad.
    // Pendiente: actualizar SRS v12.1.
    const emailVerified = await this.verificationCodeRepository.findVerifiedByContact('email', email);
    if (!emailVerified) {
      throw AppError.forbidden('El email debe estar verificado antes de registrarse');
    }

    const documentType = await this.documentTypeRepository.findById(documentTypeId);
    if (!documentType || !documentType.isActive) {
      throw AppError.notFound('Tipo de documento no encontrado');
    }
    if (!documentType.isVisibleToClient) {
      throw AppError.forbidden('Tipo de documento no permitido para registro');
    }

    return { colombia, privacyPolicyVersion: activePolicy.version, documentType };
  }

  /** @private */
  async _createUserInDBWithRollback(data: AuthRegisterService.NewUserData) {
    try {
      return await this._createUserInDB(data);
    } catch (error) {
      // La transacción interna de _createUserInDB ya revirtió cualquier escritura parcial;
      // aquí solo mapeamos el error a una respuesta operativa.
      if (shouldPropagate(error)) {
        throw error;
      }
      // Errores de la base: se loguean sus campos de diagnóstico si vienen
      const dbError = (error ?? {}) as {
        stack?: string;
        name?: string;
        sql?: string;
        fields?: unknown;
        parent?: { message?: string };
      };
      logger.error('_createUserInDB failed - error original', {
        message: errorMessage(error),
        stack: dbError.stack,
        name: dbError.name,
        sql: dbError.sql ?? null,
        fields: dbError.fields ?? null,
        parent: dbError.parent?.message ?? null
      });
      throw AppError.internal('Error al crear usuario. Intenta nuevamente');
    }
  }

  /**
   * Login automático post-registro: emite el par de tokens RS256 propios y crea la
   * sesión activa en BD (igual que _completeSuccessfulLogin del login por contraseña).
   * Recarga el usuario con rol/persona para que el access token lleve todos los claims.
   *
   * @private
   */
  async _issueAuthTokens(userId: string, auditContext: Pick<RequestAuditContext, 'ip' | 'userAgent'> = {}) {
    const user = await this.userRepository.findByUserId(userId, 'login');
    if (!user) {
      throw AppError.internal('Usuario recién creado no encontrado');
    }
    const { tokens } = await this.sessionIssuer.issue(user, {
      ip: auditContext?.ip,
      userAgent: auditContext?.userAgent,
      source: 'registro'
    });
    return tokens;
  }

  /** @private */
  _sendWelcomeNotification(userId: string, nombre: string, email: string) {
    setImmediate(() => {
      this.notifier.notify({
        type: 'BIENVENIDA',
        userId,
        relatedEntity: null,
        metadata: { nombre, email, logoUrl: notifications.ses.logoUrl }
      }).catch(err => logger.warn('Error sending welcome notification', { error: err.message, userId }));
    });
  }

  // ============================================================
  // RESET CREDENTIALS → CredentialResetService
  // ============================================================

  requestResetCredentials(data: Parameters<AuthRegisterService['credentialReset']['requestResetCredentials']>[0]) {
    return this.credentialReset.requestResetCredentials(data);
  }

  confirmResetCredentials(data: Parameters<AuthRegisterService['credentialReset']['confirmResetCredentials']>[0]) {
    return this.credentialReset.confirmResetCredentials(data);
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  /** @private */
  // [RF-AUTH-01] | CA-01 | Valida unicidad de documento
  // y correo antes de crear el registro → 409 si existen.
  async _validateRegistration(email: string, nationalId: string, genderId: string | null | undefined) {
    const [existingContact, existingPerson] = await Promise.all([
      this.personContactRepository.findByEmail(email),
      this.personRepository.findByNationalId(nationalId)
    ]);

    if (existingContact) {
      throw AppError.conflict('El email ya está registrado');
    }
    if (existingPerson) {
      throw AppError.conflict('El número de documento ya está registrado');
    }
    if (genderId) {
      const genderExists = await this.genderRepository.exists({ genderId });
      if (!genderExists) {
        throw AppError.notFound('El género seleccionado no existe');
      }
    }
  }

  /** @private */
  async _createUserInDB(data: AuthRegisterService.NewUserData) {
    // Alta atómica: persona, contacto, usuario, preferencia de notificación y consentimientos se
    // confirman juntos o no queda nada. La constancia del consentimiento es el entregable de habeas
    // data: sin ella no hay cuenta.
    const result = await this.unitOfWork.run(async () => {
      const result = await this._createAllEntities(data);
      await this._createDefaultNotificationPreference(result.user.userId);
      await this._recordRegistrationConsents(result.user.userId, data);
      return result;
    });
    logger.info('User created in DB', {
      userId: result.user.userId,
      roleId: result.role.roleId
    });
    return result;
  }

  /** @private */
  // Creación transaccional: Person → PersonContact → User (rol CLIENTE).
  // El usuario inicia onboarding con rol base; la promoción a un rol verificado
  // es responsabilidad del flujo de verificación que definas en tu dominio.
  async _createAllEntities({
    email,
    firstName,
    middleName,
    lastName,
    secondLastName,
    nationalId,
    documentTypeId,
    genderId,
    countryId,
    birthDate,
    password,
    authUsername,
    privacyPolicyVersion,
    privacyPolicyAcceptedAt,
    privacyPolicyAcceptedIp
  }: AuthRegisterService.NewUserData) {
    const defaultRole = await this.roleRepository.findByName(RBAC_ROLES.CLIENTE);
    if (!defaultRole) {
      throw AppError.internal(`Rol ${RBAC_ROLES.CLIENTE} no encontrado en BD. Ejecuta el seeder RBAC.`);
    }

    const person = await this.personRepository.create({
      firstName: firstName,
      middleName: middleName,
      lastName: lastName,
      secondLastName: secondLastName,
      nationalId: nationalId,
      documentTypeId: documentTypeId,
      genderId: genderId || null,
      countryId: countryId || null,
      birthDate: birthDate
    });

    const personContact = await this.personContactRepository.create({
      personId: person.personId,
      email,
      // [RF-AUTH-01] | CA-02 | Sella verificación de correo
      // al crear la cuenta.
      emailVerifiedAt: new Date()
    });

    const user = await this.userRepository.createWithPassword({
      username: authUsername,
      authUsername: authUsername,
      password,
      personId: person.personId,
      roleId: defaultRole.roleId,
      // Política de privacidad
      privacyPolicyVersion: privacyPolicyVersion,
      privacyPolicyAcceptedAt: privacyPolicyAcceptedAt,
      privacyPolicyAcceptedIp: privacyPolicyAcceptedIp
    });


    return { user, person, personContact, role: defaultRole };
  }

  /**
   * Preferencia de notificaciones del usuario nuevo: todos los canales, sin horario de no
   * molestar. Dentro de la transacción del alta.
   * @private
   */
  async _createDefaultNotificationPreference(userId: string) {
    await this.userNotificationPreferenceRepository.upsert(userId, {
      allowPush: true,
      allowEmail: true,
      allowSms: true,
      quietHoursStart: null,
      quietHoursEnd: null
    });
  }

  /**
   * [RF-AUTH-01] | CA-01 | Registra consentimientos en user_consents: PRIVACY_POLICY (obligatorio)
   * y COMUNICACIONES_COMERCIALES (opcional). RF-ADM-04: trazabilidad de la aceptación inicial.
   * Dentro de la transacción del alta: si falla, el registro se revierte.
   * @private
   */
  async _recordRegistrationConsents(
    userId: string,
    consentData: Pick<AuthRegisterService.NewUserData, 'privacyPolicyVersion' | 'privacyPolicyAcceptedIp' | 'comunicacionesComerciales'>
  ) {
    const { privacyPolicyVersion, privacyPolicyAcceptedIp, comunicacionesComerciales } = consentData;
    await this._recordPrivacyPolicyConsent(userId, privacyPolicyVersion, privacyPolicyAcceptedIp);
    if (comunicacionesComerciales) {
      await this._recordComercialConsent(userId, privacyPolicyAcceptedIp);
    }
  }

  /** @private — RF-ADM-04: delega en ConsentRecorder y deja traza granular vía logger (NO logAudit). */
  async _recordPrivacyPolicyConsent(userId: string, policyVersion: string, ip: string | null) {
    const record = await this.consentRecorder.grantPrivacyPolicy({ userId, ip });
    if (!record) {
      return;
    }
    // El único logAudit de este punto de entrada es USER_REGISTERED — un segundo logAudit duplicaría el request.
    logger.info('Consentimiento de política de privacidad otorgado en registro', {
      userId,
      policyVersion,
      userConsentId: record?.userConsentId
    });
  }

  /** @private — comunicaciones comerciales (opcional en el registro). */
  async _recordComercialConsent(userId: string, ip: string | null) {
    const record = await this.consentRecorder.grantCommercialCommunications({ userId, ip });
    if (!record) {
      return;
    }
    logger.info('Consentimiento de comunicaciones comerciales otorgado en registro', {
      userId,
      userConsentId: record?.userConsentId
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace AuthRegisterService {
  /** Body de POST /auth/register (validado por AuthRegisterValidator). */
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
  export interface NewUserData extends Omit<RegisterInput, 'comunicacionesComerciales'> {
    countryId: string;
    authUsername: string;
    privacyPolicyVersion: string;
    privacyPolicyAcceptedAt: Date;
    privacyPolicyAcceptedIp: string | null;
    comunicacionesComerciales: boolean;
  }

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    sessionIssuer?: InstanceType<typeof SessionIssuerService>;
    credentialReset?: InstanceType<typeof CredentialResetService>;
    unitOfWork?: typeof unitOfWork;
    userRepository?: typeof userRepository;
    personRepository?: typeof personRepository;
    personContactRepository?: typeof personContactRepository;
    documentTypeRepository?: typeof documentTypeRepository;
    userNotificationPreferenceRepository?: typeof userNotificationPreferenceRepository;
    countryRepository?: typeof countryRepository;
    privacyPolicyRepository?: typeof privacyPolicyRepository;
    consentRecorder?: typeof consentRecorder;
    genderRepository?: typeof genderRepository;
    verificationCodeRepository?: typeof verificationCodeRepository;
    roleRepository?: typeof roleRepository;
    userSessionRepository?: typeof userSessionRepository;
    notifier?: typeof notifier;
  }
}

export default Object.assign(new AuthRegisterService(), { AuthRegisterService });
