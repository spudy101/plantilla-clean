// Esquemas de salida (Zod) del perfil propio: documentan lo que arma application/dto/profile.output.ts.
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';
import piiMaskingDoc from '../../../../../shared/presentation/validation/pii-masking.doc';
import { PersonContactSchema, PersonLocationSchema, PersonSchema, UserSchema } from '../../../../../shared/presentation/validation/account.schemas';

const { MASKED_EMAIL_DESC, MASKED_PHONE_DESC } = piiMaskingDoc;

/**
 * El perfil. Cada consentimiento del catálogo tiene la forma que decide legal: quien documenta el perfil
 * (src/main/swagger) le pasa ese esquema.
 */
export function profileSchema(consentCatalogItem: z.ZodType) {
  return z
    .object({
      user: UserSchema.nullable(),
      person: PersonSchema.nullable().optional(),
      contact: PersonContactSchema.nullable().optional(),
      location: PersonLocationSchema.nullable().optional(),
      consents: z
        .array(consentCatalogItem)
        .optional()
        .meta({ description: 'Consentimientos del catálogo con el estado del usuario en cada uno.' })
    })
    .meta({ description: 'Perfil del usuario autenticado: cuenta, persona, contacto, ubicación y consentimientos.' });
}

export const EmailUpdatedSchema = z.object({
  newEmail: z.string().nullable().meta({ example: '****n@example.com', description: MASKED_EMAIL_DESC }),
  updatedAt: dateTime()
});

export const PhoneUpdatedSchema = z.object({
  phoneType: z.enum(['primary', 'secondary']),
  phone: z.string().nullable().meta({ example: '******4567', description: MASKED_PHONE_DESC }),
  phonePrefixId: z.uuid(),
  updatedAt: dateTime()
});

export const NamesUpdatedSchema = z.object({
  personId: z.uuid(),
  firstName: z.string(),
  middleName: z.string().nullable(),
  lastName: z.string(),
  secondLastName: z.string().nullable(),
  updatedAt: dateTime().optional()
});
