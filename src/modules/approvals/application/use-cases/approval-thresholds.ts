// El umbral vigente de una operación THRESHOLD: el configurado o, si no hay o no se puede leer, su default.
import type { Logger } from '../../../../shared/application/ports/logger.port';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import { thresholdOf, type DualApprovalOperation } from '../../domain/dual-approval-operation';
import type { ApprovalThresholds } from '../ports/approval-thresholds.port';

const { errorMessage } = errorMessageModule;

export async function currentThreshold(op: DualApprovalOperation, thresholds: ApprovalThresholds, logger: Logger): Promise<number> {
  if (!op.thresholdConfigKey) {
    return thresholdOf(op, null);
  }
  try {
    return thresholdOf(op, await thresholds.read(op.thresholdConfigKey));
  } catch (err) {
    logger.warn('[DualApproval] No se pudo leer umbral de SystemGlobalConfig — usando default', {
      error: errorMessage(err),
      configKey: op.thresholdConfigKey
    });
    return thresholdOf(op, null);
  }
}
