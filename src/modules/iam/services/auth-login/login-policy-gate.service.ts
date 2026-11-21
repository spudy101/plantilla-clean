import type { UserWith } from '../../repositories/user.repository';
import type { PrivacyPolicy } from '../../../../shared/database/generated/prisma/client';
// modules/shared-endpoints/kyc/iam/services/auth-login/login-policy-gate.service.ts
//
// Compuerta de política de privacidad en el login. La comparten el login por contraseña y el
// biométrico (antes estaba copiada en ambos). Extraído por SOLID: S.

import userRepository from '../../repositories/user.repository';
import legalModule from '../../../legal';
const { privacyPolicyRepository, consentRecorder } = legalModule;
import loggerUtilModule from '../../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../../shared/constants';
const { INTERNAL_ROLE_NAMES } = constantsModule;
import authLoginDtoModule from '../../responses/auth-login.response';
const { PolicyUpdateRequiredDTO } = authLoginDtoModule;
import auditModule from '../../../audit';
const { audit } = auditModule;
import type { AuditActionKey } from '../../../audit';

class LoginPolicyGateService {
  userRepository: typeof userRepository;
  privacyPolicyRepository: typeof privacyPolicyRepository;
  consentRecorder: typeof consentRecorder;

  /**
   * @param {object} [deps] Dependencias inyectables (SOLID: D).
   */
  constructor(deps: LoginPolicyGateService.Deps = {}) {
    this.userRepository = deps.userRepository ?? userRepository;
    this.privacyPolicyRepository = deps.privacyPolicyRepository ?? privacyPolicyRepository;
    this.consentRecorder = deps.consentRecorder ?? consentRecorder;
  }

  /**
   * Verifica si el usuario tiene la versión activa de la política de privacidad.
   * Si el request trae `acceptPolicy: true`, registra la versión activa y deja continuar
   * el login en un solo paso.
   *
   * @param {Object} user
   * @param {boolean} acceptPolicy - true si el usuario aceptó la política en este request
   * @param {string|null} ip
   * @param {{ blockedAuditAction: string, source: string }} context
   *   blockedAuditAction: acción de auditoría al bloquear (p. ej. LOGIN_BLOCKED_POLICY_UPDATE)
   *   source: origen para los logs (p. ej. 'auth-login', 'auth-biometric')
   * @returns {Promise<null|Object>} null → el login continúa; PolicyUpdateRequiredDTO → bloqueado
   */
  async check(
    user: UserWith<'login'>,
    acceptPolicy: boolean | undefined,
    ip: string | null,
    { blockedAuditAction, source }: { blockedAuditAction: AuditActionKey; source: string }
  ) {
    const activePolicy = await this.privacyPolicyRepository.findActive();

    // Los usuarios internos no están sujetos a la política de privacidad de clientes.
    if (user.role && INTERNAL_ROLE_NAMES.includes(user.role.name)) {
      return null;
    }
    // Sin política activa configurada → dejamos pasar
    if (!activePolicy) {
      return null;
    }
    // Ya tiene la versión activa → OK
    if (user.privacyPolicyVersion === activePolicy.version) {
      return null;
    }

    if (acceptPolicy === true) {
      await this._accept(user, activePolicy, ip, source);
      return null;
    }

    await audit.record(blockedAuditAction, {
      actorId: user.userId,
      details: {
        userVersion: user.privacyPolicyVersion || 'ninguna',
        activeVersion: activePolicy.version
      },
      entityType: 'PrivacyPolicy',
      entityTable: 'privacy_policies',
      outcome: 'failure'
    });

    return PolicyUpdateRequiredDTO({
      currentVersion: user.privacyPolicyVersion || null,
      newVersion: activePolicy.version,
      documentUrl: activePolicy.documentUrl,
      summary: activePolicy.summary,
      effectiveDate: activePolicy.effectiveDate
    });
  }

  /** @private — el cliente aceptó en este mismo request: registrar y dejar pasar */
  async _accept(user: UserWith<'login'>, activePolicy: PrivacyPolicy, ip: string | null, source: string) {
    await this.userRepository.updatePrivacyPolicy(user.userId, {
      version: activePolicy.version,
      acceptedAt: new Date(),
      acceptedIp: ip || null
    });

    // RF-ADM-04: trazabilidad granular en user_consents (best-effort)
    await this.consentRecorder
      .grantPrivacyPolicy({ userId: user.userId, privacyPolicyId: activePolicy.privacyPolicyId, ip })
      .catch(err =>
        logger.warn(`${source}: no se pudo registrar user_consent de privacy policy`, {
          userId: user.userId,
          error: err.message
        })
      );

    await audit.record('PRIVACY_POLICY_ACCEPTED', {
      actorId: user.userId,
      details: { version: activePolicy.version, ip: ip || null },
      entityType: 'PrivacyPolicy',
      entityTable: 'privacy_policies'
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace LoginPolicyGateService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userRepository?: typeof userRepository;
    privacyPolicyRepository?: typeof privacyPolicyRepository;
    consentRecorder?: typeof consentRecorder;
  }
}

export default LoginPolicyGateService;
