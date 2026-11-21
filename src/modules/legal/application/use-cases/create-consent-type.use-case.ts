// Caso de uso: un administrador crea un tipo de consentimiento.
//
// La entidad resuelve el código normalizado (mayúsculas) y los valores por defecto; la unicidad se verifica
// con el código YA normalizado ("abc" choca con "ABC").
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { ConsentTypeRepository } from '../ports/consent-type-repository.port';
import { ConsentType, type ConsentTypeDefinition } from '../../domain/consent-type';
import { ConsentTypeCodeTakenError } from '../../domain/errors';
import { toConsentTypeDetailOutput, type ConsentTypeDetailOutput } from '../dto/consent-type.output';
import { CONSENT_TYPE_AUDIT_ENTITY } from './legal-audit';
import { noticeConsentTypeAdmin, type ConsentTypeNoticeDeps } from './consent-type-admin-notice';

export class CreateConsentType {
  constructor(
    private readonly consentTypes: ConsentTypeRepository,
    private readonly audit: AuditTrail,
    private readonly logger: Logger,
    private readonly notice: ConsentTypeNoticeDeps
  ) {}

  async execute({ actorId, definition }: { actorId: string; definition: ConsentTypeDefinition }): Promise<ConsentTypeDetailOutput> {
    const newType = ConsentType.define(definition);
    if (await this.consentTypes.existsWithCode(newType.code)) {
      throw new ConsentTypeCodeTakenError(newType.code);
    }

    const created = await this.consentTypes.create(newType);

    await this.audit.record('CONSENT_TYPE_CREATED', {
      actorId,
      details: { code: created.code, name: created.name },
      ...CONSENT_TYPE_AUDIT_ENTITY,
      entityId: created.consentTypeId
    });

    this.logger.info('CreateConsentType', { code: created.code, adminUserId: actorId });
    noticeConsentTypeAdmin(this.notice, 'creado', created, actorId);
    return toConsentTypeDetailOutput(created);
  }
}
