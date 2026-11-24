// Mapper fila de Prisma → entidades de person: los hashes de búsqueda y el origen no salen de la infraestructura.
import { PersonMapper } from './person.mapper';

const AT = new Date('2026-01-01T00:00:00Z');
const origin = { originSessionId: 's-1', originCorrelationId: 'c-1' };

describe('PersonMapper', () => {
  it('persona sin national_id_hash ni origen', () => {
    const row = {
      personId: 'p-1',
      firstName: 'Ana',
      lastName: 'Pérez',
      middleName: null,
      secondLastName: null,
      nationalId: '1020304050',
      nationalIdHash: 'h',
      documentTypeId: null,
      birthDate: null,
      genderId: null,
      countryId: null,
      createdAt: AT,
      updatedAt: AT,
      ...origin
    };
    const person = PersonMapper.personToDomain(row);
    expect(person).not.toHaveProperty('nationalIdHash');
    expect(person).not.toHaveProperty('originSessionId');
    expect(person).toMatchObject({ personId: 'p-1', nationalId: '1020304050' });
  });

  it('contacto con sus prefijos (solo el prefijo)', () => {
    const row = {
      personContactId: 'pc-1',
      personId: 'p-1',
      email: 'ana@correo.co',
      emailHash: 'h',
      emailVerifiedAt: AT,
      phonePrimary: '300',
      phonePrimaryHash: 'h',
      phonePrimaryPrefixId: 'pp',
      phonePrimaryVerifiedAt: null,
      phoneSecondary: null,
      phoneSecondaryHash: null,
      phoneSecondaryPrefixId: null,
      phoneSecondaryVerifiedAt: null,
      createdAt: AT,
      updatedAt: AT,
      ...origin,
      phonePrimaryPrefix: { prefix: '+57' },
      phoneSecondaryPrefix: null
    };
    const contact = PersonMapper.contactWithPrefixesToDomain(row);
    expect(contact).not.toHaveProperty('emailHash');
    expect(contact).toMatchObject({ email: 'ana@correo.co', phonePrimaryPrefix: { prefix: '+57' }, phoneSecondaryPrefix: null });
  });

  it('ubicación con país, departamento y ciudad', () => {
    const place = { isActive: true, createdAt: AT, updatedAt: AT };
    const row = {
      personLocationId: 'pl-1',
      personId: 'p-1',
      countryId: 'co',
      departmentId: 'd',
      cityId: 'c',
      address: 'Calle 1',
      postalCode: null,
      type: null,
      createdAt: AT,
      updatedAt: AT,
      ...origin,
      country: { countryId: 'co', name: 'Colombia', code: 'COL', iconUrl: null, ...place },
      department: { departmentId: 'd', name: 'Antioquia', daneCode: '05', countryId: 'co', ...place },
      city: { cityId: 'c', name: 'Medellín', daneCode: '001', departmentId: 'd', ...place }
    };
    expect(PersonMapper.locationWithPlacesToDomain(row)).toEqual({
      personLocationId: 'pl-1',
      personId: 'p-1',
      countryId: 'co',
      departmentId: 'd',
      cityId: 'c',
      address: 'Calle 1',
      postalCode: null,
      type: null,
      country: { countryId: 'co', name: 'Colombia', code: 'COL', iconUrl: null },
      department: { departmentId: 'd', name: 'Antioquia', daneCode: '05' },
      city: { cityId: 'c', name: 'Medellín', daneCode: '001' }
    });
  });
});
