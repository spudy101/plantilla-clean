// Puertos de persistencia de la bandeja in-app: las notificaciones personales y las globales (con sus lecturas
// y el avance de su envío masivo). Los implementa infrastructure/persistence.
import type { PageRequest } from '../../../../shared/application/pagination';
import type {
  GlobalNotification,
  NewGlobalNotification,
  NewPersonalNotification,
  PersonalNotification
} from '../../domain/notification';
import type { Page } from './notification-catalog-repository.port';

export interface PersonalNotificationRepository {
  create(notification: NewPersonalNotification): Promise<PersonalNotification>;
  /** Con su tipo y la categoría del tipo (lo que necesita el envío por canal). */
  findWithType(notificationId: string): Promise<PersonalNotification | null>;
  /** Las del usuario, paginadas, con su tipo; búsqueda opcional (sin mayúsculas) en título y cuerpo. */
  listByUser(userId: string, page: PageRequest, search: string | null): Promise<Page<PersonalNotification>>;
  /** Todas las del usuario, más recientes primero, con su tipo (bandeja mezclada). */
  listAllByUser(userId: string): Promise<PersonalNotification[]>;
  countUnreadByUser(userId: string): Promise<number>;
  /** Marca como leídas las indicadas que seguían sin leer; devuelve cuántas. */
  markAsRead(notificationIds: readonly string[]): Promise<number>;
  /** Borra las leídas hace más de `days` días (sus entregas se van con ellas); devuelve cuántas. */
  deleteReadOlderThan(days: number): Promise<number>;
}

export interface BroadcastProgress {
  /** Último user_id de la página enviada. */
  cursorUserId: string;
  pushSent: number;
  emailSent: number;
  leaseMs: number;
}

export interface GlobalNotificationRepository {
  create(notification: NewGlobalNotification): Promise<GlobalNotification>;
  /** Todas, más recientes primero, con su tipo (la bandeja de todos los usuarios). */
  listAll(): Promise<GlobalNotification[]>;
  /** Las que el usuario no leyó (para el contador). */
  countUnreadByUser(userId: string): Promise<number>;
  /** Ids de las globales que el usuario leyó. */
  readIdsOf(userId: string): Promise<string[]>;
  /** Marca como leídas para el usuario las indicadas; las ya leídas no cambian. */
  markAsRead(globalNotificationIds: readonly string[], userId: string): Promise<number>;

  /**
   * Toma los envíos masivos pendientes o a medias cuya reserva venció y los reserva `leaseMs` (con su tipo y la
   * categoría). Dos instancias nunca toman el mismo.
   */
  claimDue(leaseMs: number): Promise<GlobalNotification[]>;
  /** Avance de una página: corre el cursor, suma los enviados y renueva la reserva. */
  recordProgress(globalNotificationId: string, progress: BroadcastProgress): Promise<void>;
  /** Termina el envío masivo. */
  finish(globalNotificationId: string, status: 'completed' | 'failed'): Promise<void>;
}
