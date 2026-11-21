import { z } from '../../../shared/validation/z';
import { dateTime } from '../../../shared/validation/output';
import iamModule from '../../iam';
const { authComponentsDto: componentsAuthModule } = iamModule;
const { VerificationCodeComponent } = componentsAuthModule;

function SendVerificationResponseDTO({
  verificationCode,
  truncatedCode
}: {
  verificationCode: NonNullable<Parameters<typeof VerificationCodeComponent.build>[0]>;
  /** Solo en entornos no productivos (para pruebas sin SMS/email real) */
  truncatedCode?: string | null;
}) {
  const built = VerificationCodeComponent.build(verificationCode);
  const result: { verificationCodeId: string | undefined; expiresAt: unknown; truncatedCode?: string } = {
    verificationCodeId: built?.verificationCodeId,
    expiresAt: built?.expiresAt
  };
  if (truncatedCode) {
    result.truncatedCode = truncatedCode;
  }
  return result;
}

function VerifyCodeResponseDTO() {
  return { verified: true };
}

export default {
  SendVerificationResponseDTO,
  VerifyCodeResponseDTO
};

// ── Esquemas de salida ──
export const SendVerificationSchema = z.object({
  verificationCodeId: z.uuid(),
  expiresAt: dateTime(),
  truncatedCode: z.string().optional().meta({ description: 'Código parcial. Solo fuera de producción, para pruebas.' })
});

export const VerifyCodeSchema = z.object({ verified: z.literal(true) });
