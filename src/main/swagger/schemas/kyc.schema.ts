// Esquemas globales de catálogos, cuenta y persona (los usan los specs admin y client): generados desde los
// esquemas Zod de cada módulo, es decir, desde lo que de verdad arman sus componentes.
// Los datos personales de las respuestas salen enmascarados (RF-USR-01 CA-6); los requests van completos.
import { toOpenApi } from '../../../shared/presentation/validation/openapi';
import {
  AvatarSchema,
  AvatarThemeSchema,
  CitySchema,
  CountrySchema,
  DepartmentSchema,
  GenderSchema,
  PhonePrefixSchema,
  RoleSchema
} from '../../../modules/catalogs/presentation/http/responses/catalog.response';
import {
  PersonContactSchema,
  PersonLocationSchema,
  PersonSchema,
  UserSchema
} from '../../../shared/presentation/validation/account.schemas';
import { profileSchema } from '../../../modules/person/presentation/http/responses/profile.response';
import { MyConsentCatalogItemSchema } from '../../../modules/legal/presentation/http/responses/legal.response';
import {
  TrustedDeviceSchema,
  UserChangeLogSchema,
  UserSessionSchema,
  VerificationCodeSchema
} from '../../../modules/iam/presentation/http/responses/auth-components.response';

/** El perfil documenta sus consentimientos con el esquema de legal. */
const ProfileSchema = profileSchema(MyConsentCatalogItemSchema);

const out = (schema: Parameters<typeof toOpenApi>[0]) => toOpenApi(schema, 'output');

export default {
  // catalogs
  Country: out(CountrySchema),
  Department: out(DepartmentSchema),
  City: out(CitySchema),
  PhonePrefix: out(PhonePrefixSchema),
  Gender: out(GenderSchema),
  Role: out(RoleSchema),
  AvatarTheme: out(AvatarThemeSchema),
  Avatar: out(AvatarSchema),
  // person
  User: out(UserSchema),
  Person: out(PersonSchema),
  PersonContact: out(PersonContactSchema),
  PersonLocation: out(PersonLocationSchema),
  BasicProfile: out(ProfileSchema),
  ExtendedProfile: out(ProfileSchema),
  // iam
  VerificationCode: out(VerificationCodeSchema),
  UserChangeLog: out(UserChangeLogSchema),
  UserSession: out(UserSessionSchema),
  TrustedDevice: out(TrustedDeviceSchema)
};
