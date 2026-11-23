// Esquema de salida del feed de actividad del propio usuario. Client-safe: nunca expone `details`, valores
// anteriores/nuevos, user-agent ni datos de terceros.
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';

export const UserActivityItemSchema = z
  .object({
    activityId: z.uuid(),
    source: z.enum(['audit_log', 'user_change_log']).meta({
      description:
        '`audit_log` = acción del propio usuario; `user_change_log` = cambio sobre su cuenta (suyo, de un admin o del sistema).'
    }),
    action: z
      .string()
      .meta({ example: 'LOGIN_SUCCESS', description: 'Acción de auditoría, o tipo de cambio (`email`, `password`…).' }),
    description: z.string().nullable().meta({ example: 'Actualización del correo electrónico' }),
    category: z.string().nullable().meta({ example: 'profile' }),
    outcome: z.string().nullable().meta({ example: 'success' }),
    changedByRole: z.string().meta({ example: 'user', description: 'user | admin | system' }),
    ip: z.string().nullable(),
    device: z
      .object({ deviceId: z.uuid(), name: z.string().nullable().meta({ example: 'iPhone de Camilo' }) })
      .nullable()
      .meta({
        description: 'Dispositivo del propio usuario que hizo la acción. null si fue un admin, el sistema o no hay dispositivo.'
      }),
    occurredAt: dateTime().nullable()
  })
  .meta({ description: 'Evento del feed de actividad del propio usuario. Nunca expone details, valores ni datos de terceros.' });
