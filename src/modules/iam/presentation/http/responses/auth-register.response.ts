// Esquema de salida (Zod) del registro.
import { z } from '../../../../../shared/presentation/validation/z';
import { PersonContactSchema, PersonSchema, UserSchema } from '../../../../../shared/presentation/validation/account.schemas';

export const RegisterSchema = z
  .object({
    user: UserSchema.nullable(),
    tokens: z.object({ accessToken: z.string(), refreshToken: z.string(), expiresIn: z.number().int() }),
    person: PersonSchema.nullable().optional(),
    contact: PersonContactSchema.nullable().optional()
  })
  .meta({
    description: 'Cuenta recién creada. Excepción al enmascarado: devuelve los datos completos que el usuario acaba de ingresar.'
  });
