// Esquemas de salida (Zod) de las piezas de person: contacto, ubicación, cuenta, persona y referencia. Son la
// documentación de lo que arman application/dto/person.output.ts; los incluyen también las respuestas de iam
// (por el index.ts) y los esquemas globales de Swagger.
//
// Los campos opcionales aparecen según las opciones de build (includeRole, includeGender, …).
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';
import piiMaskingDoc from '../../../../../shared/presentation/validation/pii-masking.doc';

const { MASKED_DOCUMENT_DESC, MASKED_EMAIL_DESC, MASKED_PHONE_DESC } = piiMaskingDoc;
const maskedPhone = z.string().nullable().meta({ example: '******4567', description: MASKED_PHONE_DESC });

export const PersonContactSchema = z.object({
  personContactId: z.uuid(),
  personId: z.uuid(),
  email: z.string().nullable().meta({ example: '****n@example.com', description: MASKED_EMAIL_DESC }),
  emailVerifiedAt: dateTime().nullable(),
  isEmailVerified: z.boolean(),
  phonePrimary: maskedPhone,
  phonePrimaryPrefixId: z.uuid().nullable(),
  phonePrimaryPrefix: z.string().nullable().meta({ example: '+57' }),
  phonePrimaryFull: maskedPhone,
  phonePrimaryVerifiedAt: dateTime().nullable(),
  isPhonePrimaryVerified: z.boolean(),
  phoneSecondary: maskedPhone,
  phoneSecondaryPrefixId: z.uuid().nullable(),
  phoneSecondaryPrefix: z.string().nullable(),
  phoneSecondaryFull: maskedPhone,
  phoneSecondaryVerifiedAt: dateTime().nullable(),
  isPhoneSecondaryVerified: z.boolean()
});

const CountryRefSchema = z.object({
  countryId: z.uuid(),
  name: z.string().meta({ example: 'Colombia' }),
  code: z.string().meta({ example: 'COL' }),
  iconUrl: z.string().nullable()
});

export const PersonLocationSchema = z.object({
  personLocationId: z.uuid(),
  personId: z.uuid(),
  address: z.string().meta({ example: 'Calle 10 # 20-30' }),
  postalCode: z.string().nullable(),
  type: z.string().nullable().meta({ example: 'home' }),
  countryId: z.uuid().nullable(),
  departmentId: z.uuid(),
  cityId: z.uuid(),
  country: CountryRefSchema.optional(),
  department: z.object({ departmentId: z.uuid(), name: z.string(), daneCode: z.string().nullable() }).optional(),
  city: z.object({ cityId: z.uuid(), name: z.string(), daneCode: z.string().nullable() }).optional()
});

export const UserSchema = z.object({
  userId: z.uuid(),
  username: z.string().meta({ example: 'jperez' }),
  personId: z.uuid(),
  roleId: z.uuid(),
  avatarId: z.uuid().nullable(),
  isActive: z.boolean().nullable(),
  deletedAt: dateTime().nullable().meta({ description: 'Fecha de eliminación lógica. null si la cuenta está vigente.' }),
  totpEnabled: z.boolean().nullable(),
  smsMfaEnabled: z.boolean(),
  preferredMfaMethod: z.string().meta({ example: 'none', description: 'none | totp | sms' }),
  privacyPolicyVersion: z.string().nullable().meta({ example: '1.0' }),
  privacyPolicyAcceptedAt: dateTime().nullable(),
  privacyPolicyAcceptedIp: z.string().nullable(),
  createdAt: dateTime(),
  updatedAt: dateTime(),
  role: z
    .object({ roleId: z.uuid(), name: z.string().meta({ example: 'CLIENTE' }), description: z.string().nullable() })
    .optional(),
  avatar: z
    .object({
      avatarId: z.uuid(),
      name: z.string(),
      imageUrl: z.string().nullable(),
      theme: z.object({ avatarThemeId: z.uuid(), name: z.string() }).nullable()
    })
    .optional()
});

export const PersonSchema = z.object({
  personId: z.uuid(),
  firstName: z.string().meta({ example: 'Juan' }),
  lastName: z.string().meta({ example: 'Pérez' }),
  middleName: z.string().nullable(),
  secondLastName: z.string().nullable(),
  fullName: z.string().meta({ example: 'Juan Pérez' }),
  nationalId: z.string().nullable().meta({ example: '******4050', description: MASKED_DOCUMENT_DESC }),
  birthDate: dateTime().nullable(),
  genderId: z.uuid().nullable(),
  countryId: z.uuid().nullable(),
  documentTypeId: z.uuid().nullable(),
  createdAt: dateTime(),
  updatedAt: dateTime(),
  gender: z.object({ genderId: z.uuid(), name: z.string() }).optional(),
  documentType: z.object({ documentTypeId: z.uuid(), code: z.string().meta({ example: 'CC' }), name: z.string() }).optional(),
  nationality: CountryRefSchema.optional(),
  contact: PersonContactSchema.nullable().optional(),
  location: PersonLocationSchema.nullable().optional(),
  user: UserSchema.nullable().optional()
});

export const PersonReferenceSchema = z.object({
  personReferenceId: z.uuid(),
  referenceName: z.string().meta({ example: 'María López' }),
  referencePhone: z.string().nullable().meta({ example: '******4567', description: MASKED_PHONE_DESC }),
  referenceType: z.enum(['conocido', 'familiar']),
  createdAt: dateTime()
});
