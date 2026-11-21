import type { PersonReference } from '../../../shared/database/generated/prisma/client';
// modules/client/kyc/services/person-reference.service.ts

import AppError from '../../../shared/http/app-error.util';
import personReferenceRepository from '../repositories/person-reference.repository';
import personReferenceDtoModule from '../responses/person-reference.response';
const { PersonReferenceDTO, PersonReferenceListDTO } = personReferenceDtoModule;
import auditModule from '../../audit';
const { audit } = auditModule;

const MAX_REFERENCES_PER_PERSON = 5;

class PersonReferenceService {
  personReferenceRepository: typeof personReferenceRepository;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new PersonReferenceService({ personReferenceRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: PersonReferenceService.Deps = {}) {
    this.personReferenceRepository = deps.personReferenceRepository ?? personReferenceRepository;
  }

  async list(personId: string, userId: string) {
    const references = await this.personReferenceRepository.findAllByPersonId(personId);
    await audit.record('PROFILE_REFERENCES_VIEWED', {
      actorId: userId,
      details: { count: references.length },
      entityType: 'PersonReference',
      entityTable: 'person_references'
    });
    return references.map(r => PersonReferenceListDTO(r));
  }

  async create(data: PersonReferenceService.ReferenceInput, personId: string, userId: string) {
    const existing = await this.personReferenceRepository.findAllByPersonId(personId);
    if (existing.length >= MAX_REFERENCES_PER_PERSON) {
      throw AppError.badRequest(`No puede agregar más de ${MAX_REFERENCES_PER_PERSON} referencias`);
    }

    const reference = await this.personReferenceRepository.create({
      personId: personId,
      referenceName: data.referenceName,
      referencePhone: data.referencePhone,
      referenceType: data.referenceType
    });

    await audit.record('PROFILE_REFERENCE_CREATED', {
      actorId: userId,
      entityId: reference.personReferenceId,
      entityType: 'PersonReference',
      entityTable: 'person_references'
    });
    return PersonReferenceDTO(reference);
  }

  async update(referenceId: string, data: Partial<PersonReferenceService.ReferenceInput>, personId: string, userId: string) {
    const reference = await this.personReferenceRepository.findActiveById(referenceId, personId);
    if (!reference) {
      throw AppError.notFound('Referencia no encontrada');
    }

    const updated = await this.personReferenceRepository.update(referenceId, {
      referenceName: data.referenceName,
      referencePhone: data.referencePhone,
      referenceType: data.referenceType
    });

    await audit.record('PROFILE_REFERENCE_UPDATED', {
      actorId: userId,
      details: {
        before: {
          referenceName: reference.referenceName,
          referencePhone: reference.referencePhone,
          referenceType: reference.referenceType
        },
        after: {
          referenceName: data.referenceName ?? reference.referenceName,
          referencePhone: data.referencePhone ?? reference.referencePhone,
          referenceType: data.referenceType ?? reference.referenceType
        }
      },
      entityId: referenceId,
      entityType: 'PersonReference',
      entityTable: 'person_references'
    });
    return PersonReferenceDTO(updated);
  }

  async remove(referenceId: string, personId: string, userId: string) {
    const reference = await this.personReferenceRepository.findActiveById(referenceId, personId);
    if (!reference) {
      throw AppError.notFound('Referencia no encontrada');
    }

    await this.personReferenceRepository.update(referenceId, { isActive: false });
    await audit.record('PROFILE_REFERENCE_DELETED', {
      actorId: userId,
      entityId: referenceId,
      entityType: 'PersonReference',
      entityTable: 'person_references'
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace PersonReferenceService {
  export interface ReferenceInput {
    referenceName: string;
    referencePhone: string;
    referenceType: PersonReference['referenceType'];
  }

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    personReferenceRepository?: typeof personReferenceRepository;
  }
}

export default Object.assign(new PersonReferenceService(), { PersonReferenceService });
