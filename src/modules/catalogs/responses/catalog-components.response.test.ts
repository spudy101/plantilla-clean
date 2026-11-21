// Los esquemas de salida describen lo que de verdad arman los componentes: se arma cada uno con una fila de
// ejemplo y se valida contra su esquema. Si un componente cambia y el esquema no, este test falla (y con él,
// la documentación generada quedaría desalineada).
import components, {
  AvatarSchema,
  CitySchema,
  CountrySchema,
  DepartmentSchema,
  GenderSchema,
  PhonePrefixSchema,
  RoleSchema
} from './catalog-components.response';
import maintainers, { ActivePrivacyPolicySchema, DocumentTypeSchema } from './maintainers.response';

const at = new Date('2026-01-01T00:00:00Z');
const base = { name: 'X', isActive: true, createdAt: at, updatedAt: at };
const country = { countryId: '0f8fad5b-d9cb-469f-a165-70867728950e', code: 'CO', iconUrl: null, ...base };
const department = { departmentId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', daneCode: '05', countryId: country.countryId, country, ...base };
const city = { cityId: '16fd2706-8baf-433b-82eb-8c7fada847da', daneCode: '05001', departmentId: department.departmentId, department, ...base };

describe('esquemas de salida de catálogos', () => {
  it.each([
    ['Country', CountrySchema, components.CountryComponent.build(country)],
    ['Department', DepartmentSchema, components.DepartmentComponent.build(department, true)],
    ['City', CitySchema, components.CityComponent.build(city, true)],
    [
      'PhonePrefix',
      PhonePrefixSchema,
      components.PhonePrefixComponent.build({ phonePrefixId: country.countryId, prefix: '+57', countryId: country.countryId, country, ...base }, true)
    ],
    ['Gender', GenderSchema, components.GenderComponent.build({ genderId: country.countryId, ...base })],
    ['Role', RoleSchema, components.RoleComponent.build({ roleId: country.countryId, name: 'admin', description: null, isActive: true, createdAt: at, updatedAt: at })],
    [
      'Avatar',
      AvatarSchema,
      components.AvatarComponent.build(
        { avatarId: country.countryId, imageUrl: 'https://x/a.png', avatarThemeId: city.cityId, theme: { avatarThemeId: city.cityId, ...base }, ...base },
        true
      )
    ],
    [
      'DocumentType',
      DocumentTypeSchema,
      maintainers.ListDocumentTypesResponseDTO([{ documentTypeId: country.countryId, code: 'CC', name: 'Cédula', isVisibleToClient: true, isActive: true }], {
        totalItems: 1,
        page: 1,
        limit: 10
      }).data[0]
    ],
    [
      'ActivePrivacyPolicy',
      ActivePrivacyPolicySchema,
      maintainers.ActivePrivacyPolicyResponseDTO({ version: '1.0', documentUrl: 'https://x/p.pdf', summary: null, effectiveDate: at })
    ]
  ])('%s: la salida del componente cumple su esquema', (_name, schema, output) => {
    expect(schema.safeParse(output).error?.issues ?? []).toEqual([]);
  });
});
