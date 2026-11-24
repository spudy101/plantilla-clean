// Adaptador Prisma del puerto PersonLocationRepository (una ubicación por persona: person_id es UNIQUE).
// origin_session_id lo completa la extensión de Prisma al crear; una actualización no lo pisa.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { PersonLocationRepository } from '../../application/ports/person-location-repository.port';
import { DELETED_ADDRESS } from '../../domain/account-deletion';
import type { LocationData, PersonLocationWithPlaces } from '../../domain/person-location';
import { PersonMapper } from './person.mapper';

const WITH_PLACES = { country: true, city: true, department: true } satisfies Prisma.PersonLocationInclude;

export class PrismaPersonLocationRepository extends PrismaRepository implements PersonLocationRepository {
  async findByPersonId(personId: string): Promise<PersonLocationWithPlaces | null> {
    const row = await (await this.db()).personLocation.findUnique({ where: { personId }, include: WITH_PLACES });
    return row ? PersonMapper.locationWithPlacesToDomain(row) : null;
  }

  async save(personId: string, data: LocationData): Promise<void> {
    await (await this.db()).personLocation.upsert({ where: { personId }, create: { personId, ...data }, update: data });
  }

  async eraseAddress(personId: string): Promise<void> {
    await (await this.db()).personLocation.updateMany({ where: { personId }, data: { address: DELETED_ADDRESS, postalCode: null } });
  }
}
