// Entrada de las solicitudes de doble aprobación: listado, detalle y resolución.
import { z, withHint } from '../../../../../shared/presentation/validation/z';
import { input, pageQuery, searchQuery, uuid } from '../../../../../shared/presentation/validation/fields';
import dualApprovalModule from '../../../../../shared/domain/constants/dual-approval';
const { DUAL_APPROVAL_OPS } = dualApprovalModule;

const OPERATION_KEYS = Object.keys(DUAL_APPROVAL_OPS);
const STATUS_VALUES = ['pending', 'approved', 'rejected', 'expired'] as const;
const DECISION_VALUES = ['approve', 'reject'] as const;

export const ApprovalListQuery = z.object({
  ...pageQuery(['createdAt', 'expiresAt'], { sortBy: 'createdAt' }),
  ...searchQuery,
  operationKey: withHint(
    z
      .string()
      .trim()
      .refine(v => OPERATION_KEYS.includes(v), { error: 'operationKey inválido' })
      .optional(),
    { hint: `Indicá uno de: ${OPERATION_KEYS.join(', ')}` }
  ),
  status: withHint(z.enum(STATUS_VALUES, { error: 'status inválido' }).optional(), { hint: `Indicá uno de: ${STATUS_VALUES.join(', ')}` }),
  entityType: withHint(z.string().trim().max(100, { error: 'entityType inválido' }).optional(), { hint: 'Usá hasta 100 caracteres' })
});
export type ApprovalListQuery = z.output<typeof ApprovalListQuery>;

export const ApprovalIdParams = input({ id: uuid('La solicitud de aprobación') });

export const ResolveApprovalBody = input({
  decision: withHint(
    z.enum(DECISION_VALUES, {
      error: issue => (issue.input === undefined || issue.input === '' ? 'La decisión es requerida' : 'La decisión debe ser "approve" o "reject"')
    }),
    { hint: `Indicá uno de: ${DECISION_VALUES.join(', ')}` }
  ),
  notes: withHint(z.string().trim().max(2000, { error: 'Las notas no pueden superar 2000 caracteres' }).nullish(), { hint: 'Usá hasta 2000 caracteres' })
});
export type ResolveApprovalBody = z.infer<typeof ResolveApprovalBody>;
