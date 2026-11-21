// Caso de uso: un administrador ve el historial completo de consentimientos de un usuario.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { pageOf, pageRequest } from '../../../../shared/application/pagination';
import type { UserConsentRepository } from '../ports/user-consent-repository.port';
import { ConsentHistoryNotFoundError } from '../../domain/errors';
import { toUserConsentOutput } from '../dto/user-consent.output';
import { USER_CONSENT_AUDIT_ENTITY, type ListQuery } from './legal-audit';

export class GetUserConsentHistory {
  constructor(
    private readonly userConsents: UserConsentRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, userId, query }: { actorId: string; userId: string; query: Omit<ListQuery, 'search'> }) {
    const page = pageRequest(query);
    const { rows, count } = await this.userConsents.listHistoryByUser(userId, page);
    if (count === 0) {
      throw new ConsentHistoryNotFoundError();
    }

    await this.audit.record('CONSENT_HISTORY_VIEWED', {
      actorId,
      details: { targetUserId: userId },
      entityId: userId,
      ...USER_CONSENT_AUDIT_ENTITY
    });

    return pageOf(rows.map(toUserConsentOutput), page, count);
  }
}
