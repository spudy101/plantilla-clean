// Esquemas de salida de la doble aprobación (los de Swagger). Las formas las arma application/dto; acá solo se
// describen. Todas las keys en camelCase.
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';

const ApprovalUserRefSchema = z.object({
  userId: z.uuid(),
  username: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable()
});

const approvalBase = {
  approvalRequestId: z.uuid(),
  operationKey: z.string().meta({ example: 'RBAC_ROLE_CHANGE' }),
  status: z.string().meta({ example: 'pending', description: 'pending | approved | rejected | expired' }),
  requestedBy: ApprovalUserRefSchema.nullable(),
  requestedAt: dateTime().nullable(),
  expiresAt: dateTime().nullable()
};

export const ApprovalRequestListItemSchema = z.object({
  ...approvalBase,
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  secondApprover: ApprovalUserRefSchema.nullable(),
  resolvedAt: dateTime().nullable(),
  createdAt: dateTime().nullable()
});

export const ApprovalRequestSchema = ApprovalRequestListItemSchema.extend({
  resolutionNotes: z.string().nullable(),
  payload: z.unknown().meta({ description: 'Datos de la operación pendiente (lo que se ejecuta al aprobar).' }),
  result: z.unknown().meta({ description: 'Resultado de la ejecución (al aprobar).' }),
  originSessionId: z.string().nullable(),
  updatedAt: dateTime().nullable()
});

/** La pendiente que anotan los listados de otros módulos (src/main/swagger la publica como PendingApproval). */
export const PendingApprovalSchema = z
  .object(approvalBase)
  .nullable()
  .meta({ description: 'Solicitud de doble aprobación pendiente sobre esta entidad. null cuando no hay ninguna.' });

export const ApprovalPolicySchema = z
  .object({
    enabled: z.boolean().meta({ description: 'Siempre true: el maker-checker está siempre activo.' }),
    operations: z.array(
      z.object({
        operationKey: z.string(),
        label: z.string().meta({ example: 'Cambio de rol de usuario' }),
        condition: z.enum(['always', 'threshold']),
        approverRoles: z.array(z.string()),
        entityType: z.string(),
        ttlHours: z.number().int(),
        thresholdField: z.string().optional(),
        threshold: z.number().nullable().optional()
      })
    )
  })
  .meta({ description: 'Política de doble aprobación: operaciones gateadas y sus condiciones.' });
