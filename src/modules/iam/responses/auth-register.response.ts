import { z } from '../../../shared/presentation/validation/z';
import personModule from '../../person';
const { personComponentsDto: componentsPersonModule } = personModule;
const { UserComponent, PersonComponent, PersonContactComponent } = componentsPersonModule;

/**
 * ============================================================
 * AUTH REGISTER DTOs
 * ============================================================
 * Usa los componentes del shared — nunca duplicar lógica de mapeo aquí.
 *
 * Aliases esperados en user para RegisterResponseDTO:
 *   user.role      (Role)
 *   user.person    (Person)
 *   person.contact (PersonContact)
 *   person.gender  (Gender)
 */

/** Respuesta del registro: usuario + tokens del login automático + (self-view) persona y contacto. */
interface RegisterResponse {
  user: ReturnType<typeof UserComponent.build>;
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
  person?: ReturnType<typeof PersonComponent.build>;
  contact?: ReturnType<typeof PersonContactComponent.build>;
}

function RegisterResponseDTO({
  user,
  person,
  personContact,
  tokens
}: {
  user: Parameters<typeof UserComponent.build>[0];
  person?: Parameters<typeof PersonComponent.build>[0] | null;
  personContact?: Parameters<typeof PersonContactComponent.build>[0] | null;
  tokens: RegisterResponse['tokens'];
}): RegisterResponse {
  const dto: RegisterResponse = {
    user: UserComponent.build(user, { includeRole: true }),
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn
    }
  };

  // Self-view: el cliente ve SU propia data tras registrarse → unmask (sin enmascarar).
  if (person) {
    dto.person = PersonComponent.build(person, { includeGender: true, unmask: true });
  }

  if (personContact) {
    dto.contact = PersonContactComponent.build(personContact, { unmask: true });
  }

  return dto;
}

export default {
  RegisterResponseDTO
};

// ── Esquema de salida ──
const { UserSchema, PersonSchema, PersonContactSchema } = personModule.personSchemas;

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
