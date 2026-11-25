// Adaptadores: lo que approvals necesita de otros módulos. Viven acá porque conectan módulos; approvals no los importa.
//
//   approverDirectoryAdapter    ApproverDirectory con los usuarios de iam
//   approvalThresholdsAdapter   ApprovalThresholds con la configuración global (settings)
//   iamApprovalHandlers         las reanudaciones de las operaciones gateadas de iam (las registra el container)
//
// Cuando iam se migre, estos adaptadores llamarán a sus casos de uso en vez de a su repositorio y su servicio.
import iamModule from '../../modules/iam';
import type { ApproverDirectory } from '../../modules/approvals/application/ports/approver-directory.port';
import type { ApprovalThresholds } from '../../modules/approvals/application/ports/approval-thresholds.port';
import type { ApprovalHandler } from '../../modules/approvals/application/use-cases/approval-handlers';
import type { OperationKey } from '../../modules/approvals/domain/dual-approval-operation';

export const approverDirectoryAdapter: ApproverDirectory = {
  async activeUserIdsWithRoles(roleNames) {
    const users = await iamModule.userRepository.findActiveUsersByRoleNames(roleNames);
    return users.map(user => user.userId);
  }
};

// Ninguna operación del registro es THRESHOLD ni declara una clave de umbral, y system_global_config no tiene
// columnas de umbral. La que se agregue la expone settings en su entidad (y un caso de uso de lectura) y este
// adaptador la lee de ahí; mientras tanto no hay valor configurado y cada operación usa su default.
export const approvalThresholdsAdapter: ApprovalThresholds = {
  read: () => Promise.resolve(null)
};

/** Al aprobar: la acción real de iam (no vuelve a pasar por el gate). */
export const iamApprovalHandlers: Partial<Record<OperationKey, ApprovalHandler>> = {
  RBAC_ROLE_CHANGE: (payload, ctx) => {
    const { userId, roleId } = payload as { userId: string; roleId: string };
    return iamModule.AdminUserService.executeChangeRole(userId, roleId, ctx);
  },
  INTERNAL_USER_DELETE: (payload, ctx) => iamModule.AdminUserService.executeDeleteUser((payload as { userId: string }).userId, ctx)
};
