// API pública del módulo approvals para los módulos que todavía no están en Clean Architecture (iam).
//
// En Clean, approvals no se usa importando este index: src/main/container.ts arma el módulo
// (createApprovalsModule en approvals.module.ts), reparte su gate y registra las reanudaciones. Lo que queda acá es
// TRANSITORIO: el gate y el badge de pendientes de los usuarios internos de iam. Cuando iam se migre, los recibirá
// por un puerto propio y esto se borra.
//
// Se carga al usarse (getter): los módulos se usan entre sí y un index que cargara todo de una vez crearía ciclos.
import { interopDefault } from '../../shared/kernel/interop.util';

export default {
  /** @deprecated Transitorio para iam: dualApproval.gate(opKey, { entityType, entityId, payload, ctx }) y annotatePending(entityType, rows, idField). */
  get dualApproval() {
    return interopDefault(require('./infrastructure/legacy/dual-approval') as typeof import('./infrastructure/legacy/dual-approval'));
  }
};
