// Caso de uso: un administrador publica una versión nueva de la política de privacidad.
//
// Flujo: la versión no debe existir → el PDF se publica en su ruta predecible (regla del dominio) → se
// invalida la copia en caché de la política vigente → se guarda como la ÚNICA vigente (la anterior deja de
// estarlo) → se audita → se avisa a todos los usuarios sin bloquear la respuesta (RF-ADM-04).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Notifier } from '../../../../shared/application/ports/notifier.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { PrivacyPolicyRepository } from '../ports/privacy-policy-repository.port';
import type { PolicyDocumentStorage } from '../ports/policy-document-storage.port';
import type { ActivePrivacyPolicyCache } from '../ports/active-privacy-policy-cache.port';
import { PrivacyPolicy } from '../../domain/privacy-policy';
import { PolicyDocumentRequiredError, PrivacyPolicyVersionTakenError } from '../../domain/errors';
import { toPublishedPrivacyPolicyOutput, type PublishedPrivacyPolicyOutput } from '../dto/privacy-policy.output';
import { PRIVACY_POLICY_AUDIT_ENTITY } from './legal-audit';

/** Tipo de notificación (global) que reciben los usuarios cuando cambia la política. */
export const PRIVACY_POLICY_UPDATE_NOTIFICATION = 'PRIVACY_POLICY_UPDATE';
const DEFAULT_CHANGE_SUMMARY = 'Hemos realizado mejoras en nuestra política para proteger mejor tus datos.';

export interface PublishPrivacyPolicyInput {
  actorId: string;
  version: string;
  /** El PDF; null si no vino en la petición. */
  document: Uint8Array | null;
  summary?: string | null;
  effectiveDate?: Date;
}

export class PublishPrivacyPolicy {
  constructor(
    private readonly policies: PrivacyPolicyRepository,
    private readonly documents: PolicyDocumentStorage,
    private readonly activePolicyCache: ActivePrivacyPolicyCache,
    private readonly audit: AuditTrail,
    private readonly notifier: Notifier,
    private readonly logger: Logger
  ) {}

  async execute({ actorId, version, document, summary, effectiveDate }: PublishPrivacyPolicyInput): Promise<PublishedPrivacyPolicyOutput> {
    if (!document) {
      throw new PolicyDocumentRequiredError();
    }
    if (await this.policies.versionExists(version)) {
      throw new PrivacyPolicyVersionTakenError(version);
    }

    const key = PrivacyPolicy.documentKey(version);
    const published = await this.documents.publish(key, document);
    await this.activePolicyCache.invalidate();

    const policy = await this.policies.publish({
      version,
      documentUrl: published.url,
      documentHash: published.sha256,
      summary: summary || null,
      effectiveDate: effectiveDate || new Date()
    });

    await this.audit.record('PRIVACY_POLICY_VERSION_CREATED', {
      actorId,
      details: { version, documentUrl: published.url, s3Key: key },
      entityId: policy.privacyPolicyId,
      ...PRIVACY_POLICY_AUDIT_ENTITY
    });

    this.notifyUsers(policy, summary);
    return toPublishedPrivacyPolicyOutput(policy);
  }

  /** Aviso global a los usuarios: no bloquea la respuesta, y si falla solo se loguea. */
  private notifyUsers(policy: PrivacyPolicy, summary: string | null | undefined): void {
    this.notifier
      .notify({
        type: PRIVACY_POLICY_UPDATE_NOTIFICATION,
        userId: null,
        metadata: {
          nuevaVersion: policy.version,
          fechaVigencia: policy.effectiveDate.toISOString().split('T')[0] ?? policy.version,
          resumenCambios: summary || DEFAULT_CHANGE_SUMMARY,
          documentUrl: policy.documentUrl
        }
      })
      .catch((error: unknown) =>
        this.logger.warn('Error enviando notificación de actualización de política', {
          error: error instanceof Error ? error.message : String(error),
          version: policy.version
        })
      );
  }
}
