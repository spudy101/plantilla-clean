// Entidad: un tipo de consentimiento (política de privacidad, comunicaciones comerciales…).
//
// TypeScript puro: no sabe de Prisma ni de HTTP. Concentra las reglas del tipo: cómo se normaliza el código,
// qué valores toma por defecto al crearse, qué cambia una edición parcial y si se puede revocar o exigir.
import { ConsentNotRevocableError, OptionalConsentGateError } from './errors';

/** Códigos de los tipos que el sistema otorga por sí mismo (registro y login). */
export const CONSENT_TYPE_CODES = {
  PRIVACY_POLICY: 'PRIVACY_POLICY',
  COMUNICACIONES_COMERCIALES: 'COMUNICACIONES_COMERCIALES'
} as const;

export interface ConsentTypeProps {
  consentTypeId: string;
  code: string;
  name: string;
  description: string | null;
  /** Obligatorio: sin él no se usa el servicio. Opcional: el usuario elige. */
  isMandatory: boolean;
  isRevocable: boolean;
  /** Inactivo: no se puede otorgar ni exigir. */
  isActive: boolean;
  /** Momento del recorrido en que se pide (p. ej. ONBOARDING). */
  scope: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Lo que pide un administrador al crear un tipo. */
export interface ConsentTypeDefinition {
  code: string;
  name: string;
  description?: string | null;
  isMandatory?: boolean;
  isRevocable?: boolean;
}

/** Un tipo nuevo ya resuelto (código normalizado y valores por defecto), listo para guardar. */
export interface NewConsentType {
  code: string;
  name: string;
  description: string | null;
  isMandatory: boolean;
  isRevocable: boolean;
  isActive: boolean;
}

/** Edición parcial que puede pedir un administrador. El código y la obligatoriedad no se editan. */
export interface ConsentTypePatch {
  name?: string;
  description?: string | null;
  isActive?: boolean;
}

/** Los cambios a guardar, ya resueltos contra el estado actual. */
export interface ConsentTypeChanges {
  name: string;
  description: string | null;
  isActive: boolean;
}

/** Los códigos se guardan en mayúsculas: "abc" y "ABC" son el mismo tipo. */
export const normalizeConsentTypeCode = (code: string) => code.toUpperCase();

export class ConsentType implements ConsentTypeProps {
  declare readonly consentTypeId: string;
  declare readonly code: string;
  declare readonly name: string;
  declare readonly description: string | null;
  declare readonly isMandatory: boolean;
  declare readonly isRevocable: boolean;
  declare readonly isActive: boolean;
  declare readonly scope: string;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  private constructor(props: ConsentTypeProps) {
    Object.assign(this, props);
  }

  /** Reconstruye la entidad desde lo guardado (lo usa el mapper del repositorio). */
  static restore(props: ConsentTypeProps): ConsentType {
    return new ConsentType(props);
  }

  /** Un tipo nuevo: obligatorio y no revocable salvo que se diga lo contrario; nace activo. */
  static define(definition: ConsentTypeDefinition): NewConsentType {
    return {
      code: normalizeConsentTypeCode(definition.code),
      name: definition.name,
      description: definition.description || null,
      isMandatory: definition.isMandatory !== false,
      isRevocable: definition.isRevocable === true,
      isActive: true
    };
  }

  /** Lo que no viene en el patch conserva su valor actual. */
  changesFor(patch: ConsentTypePatch): ConsentTypeChanges {
    return {
      name: patch.name ?? this.name,
      description: patch.description !== undefined ? patch.description : this.description,
      isActive: patch.isActive !== undefined ? patch.isActive : this.isActive
    };
  }

  /** El usuario solo puede retirar un consentimiento si el tipo lo permite. */
  assertRevocable(): void {
    if (!this.isRevocable) {
      throw new ConsentNotRevocableError();
    }
  }

  /**
   * Ley 1581/2012: un consentimiento opcional NUNCA puede ser condición de acceso al servicio. Exigirlo es un
   * error de quien configuró la ruta, no del usuario.
   */
  assertCanGateAccess(): void {
    if (!this.isMandatory) {
      throw new OptionalConsentGateError(this.code);
    }
  }
}
