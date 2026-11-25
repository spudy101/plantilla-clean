// Controladores HTTP del módulo notification: traducen la petición a la entrada de un caso de uso y su salida a
// la respuesta. Sin reglas de negocio.
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import routeParamUtilModule from '../../../../shared/presentation/http/route-param.util';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import { validQuery } from '../../../../shared/presentation/validation/validate';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { UnreadCountChannel, UnreadCountEvent } from '../../application/ports/runtime.port';
import type { GetUnreadCount, ListGlobalNotifications, ListNotificationFeed, ListPersonalNotifications } from '../../application/use-cases/inbox.use-cases';
import type { UnreadCounter } from '../../application/use-cases/unread-counter';
import type { GetNotificationPreference, UpdateNotificationPreference } from '../../application/use-cases/preferences.use-cases';
import type { SendVerificationCode, VerifyCode } from '../../application/use-cases/verification-codes.use-cases';
import type {
  CreateNotificationCategory,
  DeleteNotificationCategory,
  GetNotificationCategory,
  ListNotificationCategories,
  ListNotificationTypes,
  UpdateNotificationCategory,
  UpdateNotificationType
} from '../../application/use-cases/notification-catalog.use-cases';
import type {
  CreateExternalNotification,
  GetDelivery,
  ListDeliveries,
  SendDirectAnnouncement,
  SendGlobalAnnouncement
} from '../../application/use-cases/admin-notifications.use-cases';
import type { ProcessBounceFeed } from '../../application/use-cases/bounce-feed.use-case';
import {
  CategoryListQuery,
  DeliveryListQuery,
  GlobalNotificationListQuery,
  NotificationFeedQuery,
  PersonalNotificationListQuery,
  TypeListQuery
} from './requests/notification.request';

const { asyncHandler } = errorMiddlewareModule;
const { routeParam } = routeParamUtilModule;
const { requireAuthUser } = authUserUtilModule;
const { errorMessage } = errorMessageModule;

/** Keepalive del stream SSE: 25 s < idle timeout típico de ALB/nginx (60 s). */
const SSE_HEARTBEAT_MS = 25000;
/** Ventana en la que cada conexión recalcula su contador tras una notificación global, al azar. */
const SSE_GLOBAL_REFRESH_JITTER_MS = 5000;

export interface InboxUseCases {
  feed: ListNotificationFeed;
  personal: ListPersonalNotifications;
  global: ListGlobalNotifications;
  unreadCount: GetUnreadCount;
  counter: Pick<UnreadCounter, 'compute'>;
  createExternal: CreateExternalNotification;
}

export class NotificationController {
  constructor(
    private readonly useCases: InboxUseCases,
    private readonly channel: Pick<UnreadCountChannel, 'subscribe' | 'listenerCount'>,
    private readonly logger: Logger
  ) {}

  /** GET /count/stream — SSE: emite { count } en tiempo real. */
  streamUnreadCount = async (req: Request, res: Response) => {
    const { userId } = requireAuthUser(req);
    const { logger } = this;

    res.setHeader('Content-Type', 'text/event-stream');
    // no-transform → la compresión global no comprime/bufferea el stream
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Evita el buffering del reverse proxy (nginx/ALB) que retiene los eventos
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const initialCount = await this.useCases.unreadCount.execute(userId);
      res.write(`data: ${JSON.stringify({ count: initialCount })}\n\n`);
    } catch (err) {
      logger.error('SSE initial count error', { error: errorMessage(err), userId });
      res.write(`data: ${JSON.stringify({ count: 0 })}\n\n`);
    }

    let closed = false;
    let globalRefresh: NodeJS.Timeout | null = null;
    const handler = (event: UnreadCountEvent | null | undefined) => {
      // Una global (una sola fila para todos): cada conexión recalcula su contador, tras una espera al azar para
      // que miles de conexiones no consulten la base a la vez. Varias globales seguidas, un solo recálculo.
      if (event && 'global' in event && event.global === true) {
        if (globalRefresh) {
          return;
        }
        globalRefresh = setTimeout(
          () => {
            globalRefresh = null;
            this.useCases.counter
              .compute(userId)
              .then(count => {
                if (!closed) {
                  res.write(`data: ${JSON.stringify({ count })}\n\n`);
                }
              })
              .catch(err => logger.error('SSE global count refresh error', { error: errorMessage(err), userId }));
          },
          Math.floor(Math.random() * SSE_GLOBAL_REFRESH_JITTER_MS)
        );
        return;
      }
      if (event && 'userId' in event && event.userId === userId) {
        res.write(`data: ${JSON.stringify({ count: event.count })}\n\n`);
      }
    };

    const unsubscribe = this.channel.subscribe(handler);
    logger.info('SSE stream abierto', { userId, localListeners: this.channel.listenerCount() });

    // Sin eventos la conexión queda idle y el proxy la cierra en silencio: un comentario SSE la mantiene viva.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), SSE_HEARTBEAT_MS);

    req.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      if (globalRefresh) {
        clearTimeout(globalRefresh);
      }
      unsubscribe();
      logger.info('SSE stream cerrado', { userId, localListeners: this.channel.listenerCount() });
    });
  };

  getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
    const count = await this.useCases.unreadCount.execute(requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Conteo de notificaciones no leídas obtenido exitosamente', { count });
  });

  /** POST /notifications — autenticación externa (X-API-Key). */
  createNotification = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.createExternal.execute({ request: req.body, externalService: req.externalService });
    return ApiResponse.success(res, 'Notificación creada exitosamente', data, 201);
  });

  getNotificationsList = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.feed.execute({ userId: requireAuthUser(req).userId, query: validQuery(req, NotificationFeedQuery) });
    return ApiResponse.success(res, 'Notificaciones obtenidas exitosamente', data);
  });

  getPersonalNotifications = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.personal.execute({ userId: requireAuthUser(req).userId, query: validQuery(req, PersonalNotificationListQuery) });
    return ApiResponse.success(res, 'Notificaciones personales obtenidas exitosamente', data);
  });

  getGlobalNotifications = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.global.execute({ userId: requireAuthUser(req).userId, query: validQuery(req, GlobalNotificationListQuery) });
    return ApiResponse.success(res, 'Notificaciones globales obtenidas exitosamente', data);
  });
}

export class NotificationPreferenceController {
  constructor(private readonly useCases: { get: GetNotificationPreference; update: UpdateNotificationPreference }) {}

  getPreference = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.get.execute(requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Preferencias de notificación obtenidas exitosamente', data);
  });

  updatePreference = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.update.execute({ userId: requireAuthUser(req).userId, changes: req.body });
    return ApiResponse.success(res, 'Preferencias de notificación actualizadas exitosamente', data);
  });
}

export class VerificationController {
  constructor(private readonly useCases: { send: SendVerificationCode; verify: VerifyCode }) {}

  sendVerification = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.send.execute(req.body);
    return ApiResponse.success(res, 'Código de verificación enviado', data);
  });

  verifyCode = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.verify.execute(req.body);
    return ApiResponse.success(res, 'Código verificado exitosamente', data);
  });
}

export interface CategoryUseCases {
  list: ListNotificationCategories;
  get: GetNotificationCategory;
  create: CreateNotificationCategory;
  update: UpdateNotificationCategory;
  remove: DeleteNotificationCategory;
}

export class NotificationCategoryController {
  constructor(private readonly useCases: CategoryUseCases) {}

  list = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.list.execute({ actorId: requireAuthUser(req).userId, query: validQuery(req, CategoryListQuery) });
    return ApiResponse.success(res, 'Categorías de notificación obtenidas exitosamente', data);
  });

  getById = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.get.execute({
      actorId: requireAuthUser(req).userId,
      notificationCategoryId: routeParam(req, 'notificationCategoryId')
    });
    return ApiResponse.success(res, 'Categoría de notificación obtenida exitosamente', data);
  });

  create = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.create.execute({ actorId: requireAuthUser(req).userId, data: req.body });
    return ApiResponse.success(res, 'Categoría de notificación creada exitosamente', data, 201);
  });

  update = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.update.execute({
      actorId: requireAuthUser(req).userId,
      notificationCategoryId: routeParam(req, 'notificationCategoryId'),
      data: req.body
    });
    return ApiResponse.success(res, 'Categoría de notificación actualizada exitosamente', data);
  });

  remove = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.remove.execute({
      actorId: requireAuthUser(req).userId,
      notificationCategoryId: routeParam(req, 'notificationCategoryId')
    });
    return ApiResponse.success(res, 'Categoría de notificación eliminada exitosamente', data);
  });
}

export interface TypeUseCases {
  list: ListNotificationTypes;
  update: UpdateNotificationType;
  sendGlobal: SendGlobalAnnouncement;
  sendDirect: SendDirectAnnouncement;
}

export class NotificationTypeController {
  constructor(private readonly useCases: TypeUseCases) {}

  list = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.list.execute({ actorId: requireAuthUser(req).userId, query: validQuery(req, TypeListQuery) });
    return ApiResponse.success(res, 'Tipos de notificación obtenidos exitosamente', data);
  });

  update = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.update.execute({
      actorId: requireAuthUser(req).userId,
      notificationTypeId: routeParam(req, 'notificationTypeId'),
      data: req.body
    });
    return ApiResponse.success(res, 'Tipo de notificación actualizado exitosamente', data);
  });

  createGlobalNotification = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.sendGlobal.execute({ actorId: requireAuthUser(req).userId, announcement: req.body });
    return ApiResponse.success(res, 'Notificación global creada exitosamente', data, 201);
  });

  createDirectNotification = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.sendDirect.execute({ actorId: requireAuthUser(req).userId, announcement: req.body });
    return ApiResponse.success(res, 'Notificación directa creada exitosamente', data, 201);
  });
}

export class NotificationDeliveryController {
  constructor(private readonly useCases: { list: ListDeliveries; get: GetDelivery }) {}

  list = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.list.execute({ actorId: requireAuthUser(req).userId, query: validQuery(req, DeliveryListQuery) });
    return ApiResponse.success(res, 'Entregas de notificaciones obtenidas exitosamente', data);
  });

  getById = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.useCases.get.execute({ actorId: requireAuthUser(req).userId, notificationDeliveryId: routeParam(req, 'id') });
    return ApiResponse.success(res, 'Entrega obtenida exitosamente', data);
  });
}

/** El webhook lo llama SNS (no un usuario): responde un ack. */
export class BounceFeedController {
  constructor(private readonly processFeed: ProcessBounceFeed) {}

  process = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.processFeed.execute(req.body);
    return ApiResponse.success(res, 'Webhook de bounces recibido', data);
  });
}
