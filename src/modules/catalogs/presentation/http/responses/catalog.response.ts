// Esquemas Zod de las respuestas de catálogos: describen (y documentan en Swagger) la salida de los casos de
// uso (application/dto/catalog.output.ts). La prueba de conformidad (catalog.response.test.ts) exige que esa
// salida los cumpla.
//
// Otros módulos y el Swagger global (src/main/swagger/schemas) incluyen estos esquemas: país, ciudad,
// género, rol… aparecen también dentro de las respuestas de persona y usuario.
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';

const catalogBase = {
  name: z.string().nullish(),
  isActive: z.boolean().nullish(),
  createdAt: dateTime().nullish(),
  updatedAt: dateTime().nullish()
};

export const CountrySchema = z.object({
  countryId: z.uuid(),
  code: z.string().nullish().meta({ example: 'CO' }),
  iconUrl: z.string().nullable(),
  ...catalogBase
});
export const DepartmentSchema = z.object({
  departmentId: z.uuid(),
  daneCode: z.string().nullable(),
  countryId: z.string().nullish(),
  country: CountrySchema.nullable().optional(),
  ...catalogBase
});
export const CitySchema = z.object({
  cityId: z.uuid(),
  daneCode: z.string().nullable(),
  departmentId: z.string().nullish(),
  department: DepartmentSchema.nullable().optional(),
  ...catalogBase
});
export const PhonePrefixSchema = z.object({
  phonePrefixId: z.uuid(),
  prefix: z.string().nullish().meta({ example: '+57' }),
  countryId: z.string().nullish(),
  country: CountrySchema.nullable().optional(),
  isActive: catalogBase.isActive,
  createdAt: catalogBase.createdAt,
  updatedAt: catalogBase.updatedAt
});
export const GenderSchema = z.object({ genderId: z.uuid(), ...catalogBase });
export const RoleSchema = z.object({ roleId: z.uuid(), description: z.string().nullable(), ...catalogBase });
export const AvatarThemeSchema = z.object({ avatarThemeId: z.uuid(), ...catalogBase });
export const AvatarSchema = z.object({
  avatarId: z.uuid(),
  imageUrl: z.string().nullable(),
  avatarThemeId: z.string().nullish(),
  theme: AvatarThemeSchema.nullable().optional(),
  ...catalogBase
});

export const DocumentTypeSchema = z.object({
  documentTypeId: z.uuid(),
  code: z.string().meta({ example: 'CC', description: 'Código interno del tipo de documento.' }),
  name: z.string().meta({ example: 'Cédula de Ciudadanía' }),
  isVisibleToClient: z.boolean(),
  isActive: z.boolean()
});

export const ActivePrivacyPolicySchema = z.object({
  version: z.string().meta({ example: '1.0', description: 'Versión de la política' }),
  documentUrl: z.string().meta({ description: 'URL pública del documento PDF' }),
  summary: z.string().nullable(),
  effectiveDate: dateTime()
});
