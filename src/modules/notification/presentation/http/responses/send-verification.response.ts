import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';

// ── Esquemas de salida ──
export const SendVerificationSchema = z.object({
  verificationCodeId: z.uuid(),
  expiresAt: dateTime(),
  truncatedCode: z.string().optional().meta({ description: 'Código parcial. Solo fuera de producción, para pruebas.' })
});

export const VerifyCodeSchema = z.object({ verified: z.literal(true) });
