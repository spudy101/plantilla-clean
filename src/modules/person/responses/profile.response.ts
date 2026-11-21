import { z } from '../../../shared/validation/z';
import { dateTime } from '../../../shared/validation/output';
import piiMaskingDoc from '../../../shared/validation/pii-masking.doc';
import { PersonContactSchema, PersonLocationSchema, PersonSchema, UserSchema } from './person-components.response';
import type { Person } from '../../../shared/database/generated/prisma/client';
import type { UserProfileRow } from '../../iam';
import componentsPersonModule from './person-components.response';
const { UserComponent, PersonComponent, PersonContactComponent, PersonLocationComponent } = componentsPersonModule;

import legalModule from '../../legal';
const { legalComponentsDto } = legalModule;
const { UserConsentComponent } = legalComponentsDto;
import MaskingUtil from '../../../shared/security/masking.util';

/**
 * ============================================================
 * PROFILE DTOs — CLIENT
 * ============================================================
 */

// ============================================================
// HELPER — catálogo completo de consentimientos del usuario
// (todos los tipos activos + estado de otorgamiento: granted true/false)
// ============================================================

type ConsentTypeRow = NonNullable<Parameters<typeof UserConsentComponent.buildClientCatalogItem>[0]>;
type ConsentRow = NonNullable<Parameters<typeof UserConsentComponent.buildClientCatalogItem>[1]> & { consentTypeId: string };

function _buildConsentCatalog(consentTypes: readonly ConsentTypeRow[] = [], consents: readonly ConsentRow[] = []) {
  const grantedByTypeId = new Map(consents.map(c => [c.consentTypeId, c]));
  return consentTypes.map(type =>
    UserConsentComponent.buildClientCatalogItem(type, grantedByTypeId.get(type.consentTypeId) || null)
  );
}

// ============================================================
// HELPER — construye los campos comunes del perfil básico
// ============================================================

/** Perfil: usuario + (si tiene) persona, contacto y ubicación + catálogo de consentimientos. */
interface ProfileResponse {
  user: ReturnType<typeof UserComponent.build>;
  person?: ReturnType<typeof PersonComponent.build>;
  contact?: ReturnType<typeof PersonContactComponent.build>;
  location?: ReturnType<typeof PersonLocationComponent.build>;
  consents?: ReturnType<typeof _buildConsentCatalog>;
}

// Antes devolvía `dto` o `{ dto, person }` según el caso (y los llamadores hacían `result.dto || result`):
// ahora siempre el dto.
function _buildBasicFields(user: UserProfileRow): ProfileResponse {
  const dto: ProfileResponse = {
    user: UserComponent.build(user, {
      includeRole: true,
      includeAvatar: true
    })
  };

  const { person } = user;
  if (!person) {
    return dto;
  }

  dto.person = PersonComponent.build(person, {
    includeGender: true,
    includeNationality: true,
    includeDocumentType: true
  });

  if (person.contact) {
    dto.contact = PersonContactComponent.build(person.contact);
  }

  if (person.location) {
    dto.location = PersonLocationComponent.build(person.location);
  }

  return dto;
}

// ============================================================
// PERFIL BÁSICO
// ============================================================

function BasicProfileDTO(
  user: UserProfileRow,
  consentTypes: readonly ConsentTypeRow[] = [],
  consents: readonly ConsentRow[] = []
) {
  const dto = _buildBasicFields(user);
  dto.consents = _buildConsentCatalog(consentTypes, consents);
  return dto;
}

// ============================================================
// PERFIL EXTENDIDO
// ============================================================

// Hoy idéntico al básico (mismo contrato); se mantiene el nombre para los endpoints que lo usan.
function ExtendedProfileDTO(
  user: UserProfileRow,
  consentTypes: readonly ConsentTypeRow[] = [],
  consents: readonly ConsentRow[] = []
) {
  return BasicProfileDTO(user, consentTypes, consents);
}

// ============================================================
// RESPUESTAS DE ACTUALIZACIÓN
// ============================================================

// Confirmaciones de actualización: devuelven el dato enmascarado. El valor completo lo acaba de
// escribir el propio usuario, así que la confirmación no necesita repetirlo.
function UpdateEmailResponseDTO(newEmail: string, updatedAt: Date) {
  return { newEmail: MaskingUtil.maskEmail(newEmail) || null, updatedAt };
}

function UpdatePhoneResponseDTO(phone: string, phonePrefixId: string, phoneType: 'primary' | 'secondary', updatedAt: Date) {
  return { phoneType, phone: MaskingUtil.maskPhone(phone) || null, phonePrefixId, updatedAt };
}

function UpdateNamesResponseDTO(
  person: Pick<Person, 'personId' | 'firstName' | 'middleName' | 'lastName' | 'secondLastName'> & { updatedAt?: Date }
) {
  return {
    personId: person.personId,
    firstName: person.firstName,
    middleName: person.middleName ?? null,
    lastName: person.lastName,
    secondLastName: person.secondLastName ?? null,
    updatedAt: person.updatedAt
  };
}

export default {
  BasicProfileDTO,
  ExtendedProfileDTO,
  UpdateEmailResponseDTO,
  UpdatePhoneResponseDTO,
  UpdateNamesResponseDTO
};

// ── Esquemas de salida ──
const { MASKED_EMAIL_DESC, MASKED_PHONE_DESC } = piiMaskingDoc;

export const ProfileSchema = z
  .object({
    user: UserSchema.nullable(),
    person: PersonSchema.nullable().optional(),
    contact: PersonContactSchema.nullable().optional(),
    location: PersonLocationSchema.nullable().optional(),
    consents: z
      .array(legalModule.legalSchemas.MyConsentCatalogItemSchema)
      .optional()
      .meta({ description: 'Consentimientos del catálogo con el estado del usuario en cada uno.' })
  })
  .meta({ description: 'Perfil del usuario autenticado: cuenta, persona, contacto, ubicación y consentimientos.' });

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
