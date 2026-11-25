// Piezas de salida propias de person: la referencia personal. Las de la cuenta (usuario, persona, contacto,
// ubicación) las comparte con iam y viven en shared/application/account-views.ts.
import MaskingUtil from '../../../../shared/domain/pii/masking.util';

type Maybe<T> = T | null | undefined;

export interface ReferenceView {
  personReferenceId: string;
  referenceName?: Maybe<string>;
  referencePhone?: Maybe<string>;
  referenceType?: Maybe<string>;
  createdAt?: Maybe<Date>;
}

// ── Referencia ─────────────────────────────────────────────────
export function toReferenceOutput(reference: Maybe<ReferenceView>) {
  if (!reference) {
    return null;
  }
  return {
    personReferenceId: reference.personReferenceId,
    referenceName: reference.referenceName,
    // Celular de un TERCERO (la referencia personal) → siempre enmascarado.
    referencePhone: MaskingUtil.maskPhone(reference.referencePhone) || null,
    referenceType: reference.referenceType,
    createdAt: reference.createdAt
  };
}
