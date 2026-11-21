// Lo que devuelven los casos de uso sobre tipos de consentimiento. Los campos y su orden son los de la API
// de siempre (la respuesta HTTP no cambia).
import type { ConsentType } from '../../domain/consent-type';
import type { ConsentTypeRef } from '../../domain/user-consent';

/** Vista corta: la que aparece dentro de un consentimiento o del catálogo del usuario. */
export const toConsentTypeOutput = (type: ConsentType | ConsentTypeRef) => ({
  consentTypeId: type.consentTypeId,
  code: type.code,
  name: type.name,
  isMandatory: type.isMandatory,
  isRevocable: type.isRevocable,
  isActive: type.isActive,
  scope: type.scope
});
export type ConsentTypeOutput = ReturnType<typeof toConsentTypeOutput>;

export const toConsentTypeListItemOutput = (type: ConsentType) => ({
  ...toConsentTypeOutput(type),
  createdAt: type.createdAt
});
export type ConsentTypeListItemOutput = ReturnType<typeof toConsentTypeListItemOutput>;

export const toConsentTypeDetailOutput = (type: ConsentType) => ({
  ...toConsentTypeOutput(type),
  description: type.description ?? null,
  createdAt: type.createdAt,
  updatedAt: type.updatedAt
});
export type ConsentTypeDetailOutput = ReturnType<typeof toConsentTypeDetailOutput>;
