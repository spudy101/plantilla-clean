// Casos de uso de las referencias personales del titular (portal cliente).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { PersonReferenceRepository } from '../ports/person-reference-repository.port';
import type { OwnerRef } from './own-profile.use-cases';
import { REFERENCE_AUDIT_ENTITY } from './person-audit';
import { toReferenceOutput } from '../dto/person.output';
import { assertCanAddReference, editedReference, type ReferenceData } from '../../domain/person-reference';
import { ReferenceNotFoundError } from '../../domain/errors';

export class ListReferences {
  constructor(
    private readonly references: PersonReferenceRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ userId, personId }: OwnerRef) {
    const references = await this.references.listActive(personId);
    await this.audit.record('PROFILE_REFERENCES_VIEWED', { actorId: userId, details: { count: references.length }, ...REFERENCE_AUDIT_ENTITY });
    return references.map(toReferenceOutput);
  }
}

export class CreateReference {
  constructor(
    private readonly references: PersonReferenceRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ userId, personId, data }: OwnerRef & { data: ReferenceData }) {
    assertCanAddReference((await this.references.listActive(personId)).length);
    const reference = await this.references.create(personId, {
      referenceName: data.referenceName,
      referencePhone: data.referencePhone,
      referenceType: data.referenceType
    });
    await this.audit.record('PROFILE_REFERENCE_CREATED', { actorId: userId, entityId: reference.personReferenceId, ...REFERENCE_AUDIT_ENTITY });
    return toReferenceOutput(reference);
  }
}

export class UpdateReference {
  constructor(
    private readonly references: PersonReferenceRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ userId, personId, referenceId, changes }: OwnerRef & { referenceId: string; changes: Partial<ReferenceData> }) {
    const reference = await this.references.findActive(referenceId, personId);
    if (!reference) {
      throw new ReferenceNotFoundError();
    }
    const updated = await this.references.update(referenceId, {
      referenceName: changes.referenceName,
      referencePhone: changes.referencePhone,
      referenceType: changes.referenceType
    });

    const before = { referenceName: reference.referenceName, referencePhone: reference.referencePhone, referenceType: reference.referenceType };
    await this.audit.record('PROFILE_REFERENCE_UPDATED', {
      actorId: userId,
      details: { before, after: editedReference(before, changes) },
      entityId: referenceId,
      ...REFERENCE_AUDIT_ENTITY
    });
    return toReferenceOutput(updated);
  }
}

export class RemoveReference {
  constructor(
    private readonly references: PersonReferenceRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ userId, personId, referenceId }: OwnerRef & { referenceId: string }): Promise<void> {
    if (!(await this.references.findActive(referenceId, personId))) {
      throw new ReferenceNotFoundError();
    }
    await this.references.deactivate(referenceId);
    await this.audit.record('PROFILE_REFERENCE_DELETED', { actorId: userId, entityId: referenceId, ...REFERENCE_AUDIT_ENTITY });
  }
}
