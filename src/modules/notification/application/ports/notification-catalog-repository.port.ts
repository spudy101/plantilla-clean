// Puertos de persistencia de los tipos y las categorías de notificación. Los implementa
// infrastructure/persistence (prisma-notification-type.repository, prisma-notification-category.repository).
import type { PageRequest } from '../../../../shared/application/pagination';
import type { CategoryChanges, NewCategory, NotificationCategory, NotificationType, TypeChanges } from '../../domain/notification-type';

export interface Page<T> {
  rows: T[];
  count: number;
}

export type NotificationTypeFilters = {
  isActive?: boolean;
  notificationCategoryId?: string;
};

export interface NotificationTypeRepository {
  /** El tipo ACTIVO con ese código, con su categoría. */
  findActiveByCode(code: string): Promise<NotificationType | null>;
  findById(notificationTypeId: string): Promise<NotificationType | null>;
  countByCategory(notificationCategoryId: string): Promise<number>;
  /** Listado paginado (con su categoría); búsqueda por nombre, código o descripción. */
  list(filters: NotificationTypeFilters, page: PageRequest, search: string | null): Promise<Page<NotificationType>>;
  /** null si el tipo dejó de existir. Devuelve el tipo con su categoría. */
  update(notificationTypeId: string, changes: TypeChanges): Promise<NotificationType | null>;
}

export type NotificationCategoryFilters = {
  isActive?: boolean;
  isCritical?: boolean;
};

export interface NotificationCategoryRepository {
  findById(notificationCategoryId: string): Promise<NotificationCategory | null>;
  codeExists(code: string): Promise<boolean>;
  list(filters: NotificationCategoryFilters, page: PageRequest, search: string | null): Promise<Page<NotificationCategory>>;
  create(category: NewCategory): Promise<NotificationCategory>;
  /** null si la categoría dejó de existir. */
  update(notificationCategoryId: string, changes: CategoryChanges): Promise<NotificationCategory | null>;
  delete(notificationCategoryId: string): Promise<void>;
}
