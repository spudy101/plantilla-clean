import type { PageMetadata } from '../../../shared/application/pagination';
import type { UserTrustedDevice } from '../../../shared/infrastructure/database/generated/prisma/client';
import { z } from '../../../shared/presentation/validation/z';
import { AuditLogSchema } from './audit-components.response';
import iamModule from '../../iam';
const { authComponentsDto: componentsAuthModule } = iamModule;
import type { SessionWithDeviceAndUser } from '../../iam';
import type { AuditLogWithExecutor } from '../repositories/audit-log.repository';
// Fase 5 — API admin de sesiones (traza forense). DTOs de salida.
// El timeline sale de audit_logs (fuente única); la hidratación reusa DTOs admin ya existentes.
// Mapeo campo a campo.

import componentsAuditDtoModule from './audit-components.response';
const { AuditLogComponent } = componentsAuditDtoModule;
const { UserSessionComponent } = componentsAuthModule;

function _deviceRef(
  device:
    | Pick<UserTrustedDevice, 'userTrustedDeviceId' | 'deviceName' | 'deviceType' | 'browser' | 'os' | 'status'>
    | null
    | undefined
) {
  if (!device) {
    return null;
  }
  return {
    deviceId: device.userTrustedDeviceId,
    deviceName: device.deviceName,
    deviceType: device.deviceType,
    browser: device.browser || null,
    os: device.os || null,
    status: device.status
  };
}

// Cabecera de una sesión: identidad + dispositivo + IP + ventana temporal + estado + conteo de acciones.
function SessionHeaderDTO(session: SessionWithDeviceAndUser, actionCount = 0) {
  return {
    ...UserSessionComponent.build(session),
    userId: session.userId,
    device: _deviceRef(session.device),
    actionCount
  };
}

// Listado paginado de sesiones. countMap: { [sessionId]: number } con el conteo de acciones por sesión.
function SessionTraceListDTO(
  rows: SessionWithDeviceAndUser[],
  countMap: Map<string, number>,
  metadata: PageMetadata
) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    data: list.map(s => SessionHeaderDTO(s, countMap.get(s.userSessionId) ?? 0)),
    metadata
  };
}

// Evento del timeline: el log plano + un flag hasDetail que indica si su fila de dominio es hidratable
// (tabla registrada en el registry y entity_id presente). El front pide el detalle solo al expandir.
function TimelineEventDTO(log: AuditLogWithExecutor, hasDetail: boolean) {
  return {
    ...AuditLogComponent.buildList(log),
    hasDetail: Boolean(hasDetail)
  };
}

// Detalle de sesión: cabecera + timeline paginado de audit_logs ordenado por created_at.
function SessionTimelineDTO(
  session: SessionWithDeviceAndUser,
  actionCount: number,
  timelineRows: AuditLogWithExecutor[],
  metadata: PageMetadata,
  hasDetailFn: (log: AuditLogWithExecutor) => boolean
) {
  const rows = Array.isArray(timelineRows) ? timelineRows : [];
  return {
    session: SessionHeaderDTO(session, actionCount),
    timeline: rows.map(log => TimelineEventDTO(log, hasDetailFn(log))),
    metadata
  };
}

// Hidratación por lote: filas de dominio referenciadas por el timeline, agrupadas por tabla.
// skipped: tablas referenciadas pero aún no registradas en el registry (sin detalle hidratable).
function SessionEntitiesDTO(
  sessionId: string,
  entityGroups: EntityGroupRow[],
  skipped: Array<{ entityTable: string; count: number }>
) {
  return {
    sessionId,
    entities: entityGroups,
    skipped
  };
}

/** Filas de dominio de una tabla referenciada por el timeline. */
interface EntityGroupRow {
  entityTable: string;
  entityType: string;
  count: number;
  items: unknown[];
}

const SessionTraceDto = {
  SessionHeaderDTO,
  SessionTraceListDTO,
  TimelineEventDTO,
  SessionTimelineDTO,
  SessionEntitiesDTO
};

// eslint-disable-next-line @typescript-eslint/no-namespace, @typescript-eslint/no-redeclare
declare namespace SessionTraceDto {
  type EntityGroup = EntityGroupRow;
}

export default SessionTraceDto;

// ── Esquemas de salida ──
export const SessionTraceListItemSchema = iamModule.authSchemas.UserSessionSchema.extend({
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
