// Adaptadores: lo que approvals necesita de otros módulos. Viven acá porque conectan módulos; approvals no los importa.
//
//   approverDirectory    ApproverDirectory con las cuentas de iam
//   approvalThresholds   ApprovalThresholds con la configuración global (settings)
//   iamApprovalHandlers  las reanudaciones de las operaciones gateadas de iam (las registra el container)
import type { ApproverDirectory } from '../../modules/approvals/application/ports/approver-directory.port';
import type { ApprovalThresholds } from '../../modules/approvals/application/ports/approval-thresholds.port';
import type { ApprovalHandler } from '../../modules/approvals/application/use-cases/approval-handlers';
import type { OperationKey } from '../../modules/approvals/domain/dual-approval-operation';
import type { IamModule } from '../../modules/iam/iam.module';
import type { ModuleRegistry } from './module-registry';

export function approverDirectoryAdapter(modules: ModuleRegistry): ApproverDirectory {
  return {
    activeUserIdsWithRoles: roleNames => modules.iam.directories.accounts.activeUserIdsWithRoles(roleNames)
  };
}

// Ninguna operación del registro es THRESHOLD ni declara una clave de umbral, y system_global_config no tiene
// columnas de umbral. La que se agregue la expone settings en su entidad (y un caso de uso de lectura) y este
// adaptador la lee de ahí; mientras tanto no hay valor configurado y cada operación usa su default.
export const approvalThresholdsAdapter: ApprovalThresholds = {
  read: () => Promise.resolve(null)
};

/** Al aprobar: la acción real de iam (no vuelve a pasar por el gate). */
export function iamApprovalHandlers(iam: IamModule): Partial<Record<OperationKey, ApprovalHandler>> {
  return {
    RBAC_ROLE_CHANGE: (payload, ctx) => {
      const { userId, roleId } = payload as { userId: string; roleId: string };
      return iam.useCases.executeRoleChange.execute(userId, roleId, ctx);
    },
    INTERNAL_USER_DELETE: (payload, ctx) => iam.useCases.executeUserDeletion.execute((payload as { userId: string }).userId, ctx)
  };
}
