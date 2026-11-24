// Referencias personales de una persona (un conocido o un familiar). Se borran de forma lógica.
import { ReferenceLimitReachedError } from './errors';

export type ReferenceType = 'conocido' | 'familiar';

export interface PersonReference {
  personReferenceId: string;
  personId: string;
  referenceName: string;
  referencePhone: string;
  referenceType: ReferenceType;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReferenceData {
  referenceName: string;
  referencePhone: string;
  referenceType: ReferenceType;
}

export const MAX_REFERENCES_PER_PERSON = 5;

/** Una persona tiene como mucho MAX_REFERENCES_PER_PERSON referencias vigentes. */
export function assertCanAddReference(activeReferences: number): void {
  if (activeReferences >= MAX_REFERENCES_PER_PERSON) {
    throw new ReferenceLimitReachedError(MAX_REFERENCES_PER_PERSON);
  }
}

/** Cómo queda la referencia tras una edición parcial (lo que no llega se conserva). */
export function editedReference(reference: ReferenceData, changes: Partial<ReferenceData>): ReferenceData {
  return {
    referenceName: changes.referenceName ?? reference.referenceName,
    referencePhone: changes.referencePhone ?? reference.referencePhone,
    referenceType: changes.referenceType ?? reference.referenceType
  };
}
