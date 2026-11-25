// Esquema de salida (Zod) de la referencia personal: documenta lo que arma application/dto/person.output.ts. Los de
// la cuenta (usuario, persona, contacto, ubicación) viven en shared/presentation/validation/account.schemas.ts.
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';
import piiMaskingDoc from '../../../../../shared/presentation/validation/pii-masking.doc';

const { MASKED_PHONE_DESC } = piiMaskingDoc;

export const PersonReferenceSchema = z.object({
  personReferenceId: z.uuid(),
  referenceName: z.string().meta({ example: 'María López' }),
  referencePhone: z.string().nullable().meta({ example: '******4567', description: MASKED_PHONE_DESC }),
  referenceType: z.enum(['conocido', 'familiar']),
  createdAt: dateTime()
});
