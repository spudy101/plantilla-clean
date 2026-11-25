import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';

// ── Esquemas de salida ──
export const NotificationPreferenceSchema = z.object({
  configured: z.boolean().meta({ description: 'false si el usuario nunca la configuró (se muestran los valores por defecto).' }),
  allowPush: z.boolean(),
  allowEmail: z.boolean(),
  allowSms: z.boolean(),
  quietHoursStart: z.string().nullable().meta({ example: '22:00:00' }),
  quietHoursEnd: z.string().nullable().meta({ example: '07:00:00' }),
  updatedAt: dateTime().nullable()
});
