// Esquemas de salida de la traza forense de sesiones (admin). El timeline sale de audit_logs; las filas de
// dominio hidratadas tienen la forma de cada tabla.
import { z } from '../../../../../shared/presentation/validation/z';
import { AuditLogSchema, UserSessionSchema } from './audit-components.response';

export const SessionTraceListItemSchema = UserSessionSchema.extend({
  userId: z.uuid(),
  device: z
    .object({
      deviceId: z.uuid(),
      deviceName: z.string().nullable(),
      deviceType: z.string().nullable().meta({ example: 'desktop' }),
      browser: z.string().nullable().meta({ example: 'Chrome' }),
      os: z.string().nullable().meta({ example: 'Windows' }),
      status: z.string().nullable()
    })
    .nullable(),
  actionCount: z.number().int().meta({ example: 12, description: 'Eventos de auditoría originados en esta sesión.' })
}).meta({ description: 'Sesión con su dispositivo y su conteo de acciones.' });

export const SessionTimelineEventSchema = AuditLogSchema.extend({
  hasDetail: z.boolean().meta({ description: 'true si la fila de dominio referenciada se puede hidratar (ver /entities).' })
});

export const SessionEntitiesSchema = z.object({
  sessionId: z.uuid(),
  entities: z.array(
    z.object({
      entityTable: z.string().meta({ example: 'user_trusted_devices' }),
      entityType: z.string().meta({ example: 'UserTrustedDevice' }),
      count: z.number().int(),
      items: z
        .array(z.unknown())
        .meta({ description: 'Filas hidratadas con el DTO admin de cada dominio (forma según la tabla).' })
    })
  ),
  skipped: z
    .array(z.object({ entityTable: z.string(), count: z.number().int() }))
    .meta({ description: 'Tablas referenciadas que aún no están en el registro de hidratación.' })
});
