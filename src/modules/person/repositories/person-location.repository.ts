// modules/schemas/kyc/person/repositories/person-location.repository.ts
//
// Ubicación de la persona (una por persona). origin_session_id lo completa la extensión de Prisma al
// crear; una actualización no lo pisa.
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { PersonLocation, Prisma } from '../../../shared/database/generated/prisma/client';

const WITH_PLACES = { country: true, city: true, department: true } satisfies Prisma.PersonLocationInclude;

export type PersonLocationWithPlaces = Prisma.PersonLocationGetPayload<{ include: typeof WITH_PLACES }>;
export type PersonLocationInput = Omit<Prisma.PersonLocationUncheckedCreateInput, 'personLocationId' | 'personId'>;

class PersonLocationRepository extends PrismaRepository {
  /** Ubicación de la persona con país, departamento y ciudad. */
  async findByPersonId(personId: string): Promise<PersonLocationWithPlaces | null> {
    return (await this.db()).personLocation.findUnique({ where: { personId }, include: WITH_PLACES });
  }

  /** Crea o actualiza la ubicación de la persona (person_id es UNIQUE). */
  async upsertByPersonId(personId: string, locationData: PersonLocationInput): Promise<PersonLocation> {
    return (await this.db()).personLocation.upsert({
      where: { personId },
      create: { personId, ...locationData },
      update: locationData
    });
  }

  /**
   * Anonimiza la dirección física de una persona (Ley 1581/2012 — eliminación de cuenta).
   * Conserva departamento/ciudad para estadística agregada. Devuelve cuántas filas tocó.
   */
  async anonymizeAddressByPersonId(personId: string): Promise<number> {
    return (
      await (await this.db()).personLocation.updateMany({ where: { personId }, data: { address: 'ELIMINADO', postalCode: null } })
    ).count;
  }
}

export default new PersonLocationRepository();
