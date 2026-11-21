// Formas compartidas entre los services de notificación (creación, envío, email, lotes). Solo tipos.
// Los services exportan instancias (`export =`), así que los tipos que cruzan archivos viven aquí.
import type { NotificationChannel, NotificationType } from '../../shared/infrastructure/database/generated/prisma/client';
import type { NotificationCategoryRow } from './repositories/notification-category.repository';

export type ChannelKey = NotificationChannel;

/** Flags supports<Canal> de la categoría (fuente de verdad de los canales del tipo). */
export type CategoryChannels = Partial<Record<`supports${Capitalize<ChannelKey>}`, boolean | null>>;

/** Lo que el email lee del tipo de notificación: templates y la categoría (canal + layout). */
export type EmailTemplateSource = Pick<NotificationType, 'code' | 'emailSubjectTemplate' | 'emailBodyTemplate'> & {
  category?: Pick<NotificationCategoryRow, 'supportsEmail' | 'emailLayoutTemplate'> | null;
};

/** Tipo de notificación con su categoría, tal como lo consumen el envío individual y el masivo. */
export type NotificationTypeSource = Omit<EmailTemplateSource, 'category'> & {
  category?: (CategoryChannels & { isCritical?: boolean | null } & NonNullable<EmailTemplateSource['category']>) | null;
};

/** Preferencias del usuario: horario de silencio ('HH:MM:SS') + allow<Canal>. null/undefined → todo permitido. */
export type UserPreference =
  | ({ quietHoursStart?: string | null; quietHoursEnd?: string | null } & Partial<
      Record<`allow${Capitalize<ChannelKey>}`, boolean | null>
    >)
  | null
  | undefined;
