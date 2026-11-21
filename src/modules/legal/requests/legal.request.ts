// Entrada del módulo legal: consentimientos (admin y usuario), tipos de consentimiento y políticas de privacidad.
import { z, withHint } from '../../../shared/presentation/validation/z';
import { fileField, input, optionalBool, optionalIsoDate, optionalUuid, pageQuery, searchQuery, uuid } from '../../../shared/presentation/validation/fields';

const upperCode = (label: string, hint: string) =>
  withHint(
    z
      .string({ error: `${label} es requerido` })
      .trim()
      .min(1, { error: `${label} es requerido` })
      .transform(v => v.toUpperCase()),
    { hint }
  );

// ── Consentimientos de usuarios (admin) ───────────────────────
const byGrantedAt = pageQuery(['grantedAt'], { sortBy: 'grantedAt' });
export const AdminUserConsentListQuery = z.object({
  ...byGrantedAt,
  userId: optionalUuid('El ID de usuario'),
  consentTypeCode: withHint(
    z
      .string({ error: 'consentTypeCode debe ser texto' })
      .trim()
      .transform(v => v.toUpperCase())
      .optional(),
    { hint: 'Ingresá el código del tipo de consentimiento como texto' }
  ),
  isCurrent: optionalBool('isCurrent'),
  dateFrom: optionalIsoDate('dateFrom'),
  dateTo: optionalIsoDate('dateTo')
});
export type AdminUserConsentListQuery = z.output<typeof AdminUserConsentListQuery>;

export const UserIdParams = input({ userId: uuid('El ID de usuario') });
export const ConsentHistoryQuery = z.object(byGrantedAt);
export type ConsentHistoryQuery = z.output<typeof ConsentHistoryQuery>;

// ── Tipos de consentimiento ───────────────────────────────────
export const ConsentTypeListQuery = z.object({ ...pageQuery(['createdAt', 'name', 'code'], { sortBy: 'createdAt' }), ...searchQuery });
export type ConsentTypeListQuery = z.output<typeof ConsentTypeListQuery>;
export const ConsentTypeIdParams = input({ consentTypeId: uuid('El ID de tipo de consentimiento') });

export const CreateConsentTypeBody = input({
  code: withHint(
    z
      .string({ error: 'El código es requerido' })
      .trim()
      .min(1, { error: 'El código es requerido' })
      .transform(v => v.toUpperCase())
      .pipe(z.string().regex(/^[A-Z_]+$/, { error: 'El código solo puede contener letras mayúsculas y guiones bajos' })),
    { hint: 'Usá solo letras mayúsculas y guiones bajos (ej: TERMS_AND_CONDITIONS)' }
  ),
  name: withHint(z.string({ error: 'El nombre es requerido' }).trim().min(1, { error: 'El nombre es requerido' }).max(200, { error: 'El nombre admite máximo 200 caracteres' }), {
    hint: 'Usá hasta 200 caracteres'
  }),
  description: z.string().trim().nullish(),
  isMandatory: optionalBool('El indicador de obligatoriedad'),
  isRevocable: optionalBool('El indicador de revocabilidad')
});

export const UpdateConsentTypeBody = input({
  name: withHint(z.string().trim().max(200, { error: 'El nombre admite máximo 200 caracteres' }).optional(), { hint: 'Usá hasta 200 caracteres' }),
  description: z.string().trim().nullish(),
  isActive: optionalBool('El estado')
});

// ── Políticas de privacidad (admin) ───────────────────────────
const VERSION_REGEX = /^\d+\.\d+$/;
const VERSION_HINT = 'Usá el formato N.N (ej: 1.0, 1.1, 2.0)';

export const PrivacyPolicyListQuery = z.object({
  ...pageQuery(['createdAt', 'effectiveDate', 'version'], { sortBy: 'createdAt' }),
  ...searchQuery,
  isActive: optionalBool('El estado')
});
export type PrivacyPolicyListQuery = z.output<typeof PrivacyPolicyListQuery>;

/** POST — multipart/form-data: el PDF va en req.files (campo policyDocument), el resto en el body. */
export const CreatePrivacyPolicyBody = input({
  version: withHint(
    z
      .string({ error: issue => (issue.input === undefined ? 'La versión es requerida' : 'La versión debe ser un string') })
      .min(1, { error: 'La versión es requerida' })
      .max(20, { error: 'La versión no puede superar 20 caracteres' })
      .regex(VERSION_REGEX, { error: 'La versión debe tener el formato N.N (ej: 1.0, 1.1, 2.0)' }),
    { hint: VERSION_HINT }
  ),
  summary: withHint(z.string({ error: 'El resumen debe ser un texto' }).max(1000, { error: 'El resumen no puede superar 1000 caracteres' }).trim().nullish(), {
    hint: 'Escribí un resumen de hasta 1000 caracteres'
  }),
  effectiveDate: optionalIsoDate('La fecha de vigencia')
});
export const PrivacyPolicyFiles = input({ policyDocument: fileField('policyDocument', { mimeTypes: ['application/pdf'], maxSizeMb: 20 }) });

// ── Consentimientos del propio usuario ────────────────────────
export const GrantConsentsBody = withHint(
  z
    .array(
      z.looseObject({
        consentTypeCode: upperCode('consentTypeCode', 'Incluí el código del tipo de consentimiento'),
        privacyPolicyId: optionalUuid('privacyPolicyId')
      }),
      { error: 'El cuerpo debe ser un array con al menos un consentimiento' }
    )
    .min(1, { error: 'El cuerpo debe ser un array con al menos un consentimiento' }),
  { hint: 'Enviá un array con al menos un consentimiento' }
);

export const RevokeConsentBody = input({ reason: z.string().trim().max(500, { error: 'El motivo admite máximo 500 caracteres' }).nullish() });
export const PrivacyPolicyIdParams = input({ privacyPolicyId: uuid('La política de privacidad') });
