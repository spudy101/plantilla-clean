// prisma/seeds/notification-types/types.ts
//
// Forma de un tipo de notificación en los datos del seed (prisma/seeds/notification-types.seed.ts).
// La categoría no va acá: la asigna CATEGORY_BY_TYPE en ese seed.

export interface NotificationTypeSeed {
  code: string;
  name: string;
  description: string;
  titleTemplate: string;
  bodyTemplate: string;
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
  isActive?: boolean;
}
