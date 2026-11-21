import { z } from '../../../shared/validation/z';
import { dateTime } from '../../../shared/validation/output';
import type { PreferenceRow } from '../repositories/user-notification-preference.repository';

/**
 * Preferencia del usuario tal como la aplica el envío. Si nunca la configuró (`configured: false`), los
 * valores por defecto: todos los canales permitidos y sin horario de silencio.
 */
function NotificationPreferenceDTO(preference: PreferenceRow | null) {
  return {
    configured: preference !== null,
    allowPush: preference?.allowPush ?? true,
    allowEmail: preference?.allowEmail ?? true,
    allowSms: preference?.allowSms ?? true,
    quietHoursStart: preference?.quietHoursStart ?? null,
    quietHoursEnd: preference?.quietHoursEnd ?? null,
    updatedAt: preference?.updatedAt ?? null
  };
}

export default { NotificationPreferenceDTO };

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
