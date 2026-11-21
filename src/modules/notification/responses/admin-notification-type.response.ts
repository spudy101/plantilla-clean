import type { PageMetadata } from '../../../shared/http/pagination';
import { z } from '../../../shared/validation/z';
import { dateTime } from '../../../shared/validation/output';
import { NotificationTypeSchema } from './notification-components.response';
import type { NotificationTypeWithCategory } from '../repositories/notification-type.repository';

import componentsNotificationDtoModule from './notification-components.response';
const { NotificationTypeComponent } = componentsNotificationDtoModule;


/**
 * ============================================================
 * NOTIFICATION TYPE DTOs — ADMIN
 * ============================================================
 * Admin ve los templates completos — campos que el cliente nunca ve.
 */

function NotificationTypeAdminDTO(nt: NotificationTypeWithCategory) {
  const base = NotificationTypeComponent.build(nt);
  return {
    ...base,
    // Campos adicionales solo para admin
    titleTemplate: nt.titleTemplate,
    bodyTemplate: nt.bodyTemplate,
    emailSubjectTemplate: nt.emailSubjectTemplate,
    emailBodyTemplate: nt.emailBodyTemplate,
    isActive: nt.isActive,
    updatedAt: nt.updatedAt
  };
}

function ListNotificationTypesResponseDTO(
  rows: NotificationTypeWithCategory[],
  metadata: PageMetadata
) {
  return {
    data: Array.isArray(rows) ? rows.map(r => NotificationTypeAdminDTO(r)) : [],
    metadata
  };
}

function UpdateNotificationTypeResponseDTO(nt: NotificationTypeWithCategory) {
  return NotificationTypeAdminDTO(nt);
}

function CreateGlobalNotificationResponseDTO({
  globalNotificationId,
  titulo,
  contenido,
  asunto
}: {
  globalNotificationId: string;
  titulo: string;
  contenido: string;
  asunto?: string | null;
}) {
  return {
    globalNotificationId,
    titulo,
    contenido,
    asunto,
    processingStatus: 'queued',
    createdAt: new Date()
  };
}

function CreateDirectNotificationResponseDTO({
  notificationId,
  userId,
  titulo,
  contenido,
  asunto
}: {
  notificationId: string;
  userId: string;
  titulo: string;
  contenido: string;
  asunto?: string | null;
}) {
  return {
    notificationId,
    userId,
    titulo,
    contenido,
    asunto,
    processingStatus: 'queued',
    createdAt: new Date()
  };
}

export default {
  NotificationTypeAdminDTO,
  ListNotificationTypesResponseDTO,
  UpdateNotificationTypeResponseDTO,
  CreateGlobalNotificationResponseDTO,
  CreateDirectNotificationResponseDTO
};

// ── Esquemas de salida ──
export const NotificationTypeAdminSchema = NotificationTypeSchema.extend({
  titleTemplate: z.string().meta({ example: 'Hola {{nombre}}' }),
  bodyTemplate: z.string(),
  emailSubjectTemplate: z.string().nullable(),
  emailBodyTemplate: z.string().nullable(),
  updatedAt: dateTime()
});

const queued = {
  titulo: z.string(),
  contenido: z.string(),
  asunto: z.string().nullish(),
  processingStatus: z.literal('queued').meta({ description: 'El envío se procesa en segundo plano.' }),
  createdAt: dateTime()
};

export const GlobalNotificationQueuedSchema = z.object({ globalNotificationId: z.uuid(), ...queued });
export const DirectNotificationQueuedSchema = z.object({ notificationId: z.uuid(), userId: z.uuid(), ...queued });
