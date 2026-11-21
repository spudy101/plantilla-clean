// Conformidad: la salida de los casos de uso cumple el esquema que documenta Swagger (estricto: un campo de
// más o de menos falla), y mantiene la forma que respondía la plantilla en capas.
import * as schemas from './catalog.response';
import * as output from '../../../application/dto/catalog.output';

const at = new Date('2026-01-01T00:00:00Z');
const status = { isActive: true, createdAt: at, updatedAt: at };
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const countryRef = { countryId: id(1), name: 'Colombia', code: 'COL' };

describe('Catálogos — salida conforme al esquema', () => {
  it.each([
    [
      'país',
      schemas.CountrySchema,
      output.toCountryOutput({ countryId: id(1), name: 'Colombia', code: 'COL', iconUrl: null, ...status })
    ],
    [
      'departamento con país',
      schemas.DepartmentSchema,
      output.toDepartmentOutput({
        departmentId: id(2),
        name: 'Antioquia',
        daneCode: '05',
        countryId: id(1),
        country: countryRef,
        ...status
      })
    ],
    [
      'ciudad con departamento y país',
      schemas.CitySchema,
      output.toCityOutput({
        cityId: id(3),
        name: 'Medellín',
        daneCode: '001',
        departmentId: id(2),
        department: { departmentId: id(2), name: 'Antioquia', country: countryRef },
        ...status
      })
    ],
    [
      'prefijo con país',
      schemas.PhonePrefixSchema,
      output.toPhonePrefixOutput({ phonePrefixId: id(4), prefix: '+57', countryId: id(1), country: countryRef, ...status })
    ],
    ['género', schemas.GenderSchema, output.toGenderOutput({ genderId: id(5), name: 'Femenino', ...status })],
    ['rol', schemas.RoleSchema, output.toRoleOutput({ roleId: id(6), name: 'ADMIN', description: null, ...status })],
    [
      'tema de avatar',
      schemas.AvatarThemeSchema,
      output.toAvatarThemeOutput({ avatarThemeId: id(7), name: 'Animales', ...status })
    ],
    [
      'avatar con tema',
      schemas.AvatarSchema,
      output.toAvatarOutput({
        avatarId: id(8),
        name: 'Gato',
        imageUrl: 'https://cdn.test/gato.png',
        avatarThemeId: id(7),
        theme: { avatarThemeId: id(7), name: 'Animales' },
        ...status
      })
    ],
    [
      'tipo de documento',
      schemas.DocumentTypeSchema,
      output.toDocumentTypeOutput({ documentTypeId: id(9), code: 'CC', name: 'Cédula', isVisibleToClient: true, isActive: true })
    ],
    [
      'política de privacidad',
      schemas.ActivePrivacyPolicySchema,
      output.toActivePrivacyPolicyOutput({
        version: '1.0',
        documentUrl: 'https://cdn.test/p.pdf',
        summary: null,
        effectiveDate: at
      })
    ]
  ])('%s', (_name, schema, value) => {
    expect(() => (schema as { strict: () => { parse: (v: unknown) => unknown } }).strict().parse(value)).not.toThrow();
  });

  it('las referencias anidadas mantienen la forma de la plantilla original (iconUrl/daneCode en null)', () => {
    const city = output.toCityOutput({
      cityId: id(3),
      name: 'Medellín',
      daneCode: null,
      departmentId: id(2),
      department: { departmentId: id(2), name: 'Antioquia', country: countryRef },
      ...status
    });

    expect(city.department).toEqual({
      departmentId: id(2),
      name: 'Antioquia',
      daneCode: null,
      country: { ...countryRef, iconUrl: null }
    });
  });
});
