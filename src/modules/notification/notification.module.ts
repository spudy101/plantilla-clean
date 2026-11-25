// Composición del módulo notification: el ÚNICO archivo del módulo que conoce todas sus capas.
//
//   Prisma (tipos, categorías, bandeja, entregas, preferencias, OTP, supresión) + AWS (SES, SNS) + Redis
//        ──► casos de uso ──► controllers ──► routers (bandeja, preferencias, admin, webhook)
//                   │
//                   ├──► notifier: el puerto Notifier/EmailNotifier que usan los demás módulos
//                   ├──► worker: despachador de entregas y envíos masivos, retención (cron)
//                   └──► unreadCounts: el canal en tiempo real del contador (server.ts lo conecta y lo cierra)
//
// Lo que viene de afuera (destinatarios de iam, prefijos de catalogs, auditoría, logger, transacciones, guardas)
// llega por parámetro desde src/main/. Notification no importa ningún otro módulo.
import type { RequestHandler, Router } from 'express';
import type { AuditTrail } from '../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../shared/application/ports/logger.port';
import type { EmailNotifier, Notifier } from '../../shared/application/ports/notifier.port';
import type { UnitOfWork } from '../../shared/application/ports/unit-of-work.port';
import type { RouteGuards } from '../../shared/presentation/http/route-guards';
import type { PhonePrefixes, RecipientDirectory } from './application/ports/recipient-directory.port';
import { PrismaNotificationCategoryRepository, PrismaNotificationTypeRepository } from './infrastructure/persistence/prisma-notification-catalog.repositories';
import { PrismaGlobalNotificationRepository, PrismaPersonalNotificationRepository } from './infrastructure/persistence/prisma-inbox.repositories';
import { PrismaDeliveryRepository } from './infrastructure/persistence/prisma-delivery.repository';
import { PrismaNotificationPreferenceRepository } from './infrastructure/persistence/prisma-preference.repository';
import { PrismaPushTokenRepository } from './infrastructure/persistence/prisma-push-token.repository';
import { PrismaVerificationCodeRepository } from './infrastructure/persistence/prisma-verification-code.repository';
import { PrismaEmailSuppressionRepository } from './infrastructure/persistence/prisma-email-suppression.repository';
import { PrismaSmsAttemptRepository } from './infrastructure/persistence/prisma-sms-attempt.repository';
import { SesEmailGateway } from './infrastructure/providers/ses-email.gateway';
import { SnsPushGateway } from './infrastructure/providers/sns-push.gateway';
import { SnsSmsGateway } from './infrastructure/providers/sns-sms.gateway';
import {
  RedisSendRateLimiter,
  awsErrorClassifier,
  contactCipher,
  snsBounceFeedVerifier,
  transactionProbe,
  verificationCodeGenerator
} from './infrastructure/providers/aws-runtime.adapters';
import { UnreadCountEmitter } from './infrastructure/realtime/unread-count.emitter';
import { createNotificationWorker, type NotificationWorker } from './infrastructure/workers/notification.worker';
import { bindLegacyNotification } from './infrastructure/legacy/legacy-bindings';
import { UnreadCounter } from './application/use-cases/unread-counter';
import { EmailSuppressionList } from './application/use-cases/email-suppression.use-cases';
import { SendTemplatedEmail } from './application/use-cases/send-templated-email.use-case';
import { SmsSender } from './application/use-cases/sms-sender';
import { DeliveryAttempts, DispatchDueDeliveries, ScheduleDeliveries } from './application/use-cases/deliveries.use-cases';
import { BroadcastGlobalNotification } from './application/use-cases/broadcast.use-cases';
import { CreateNotification, SendDirectEmail } from './application/use-cases/create-notification.use-case';
import { GetUnreadCount, ListGlobalNotifications, ListNotificationFeed, ListPersonalNotifications } from './application/use-cases/inbox.use-cases';
import { GetNotificationPreference, UpdateNotificationPreference } from './application/use-cases/preferences.use-cases';
import {
  CreateNotificationCategory,
  DeleteNotificationCategory,
  GetNotificationCategory,
  ListNotificationCategories,
  ListNotificationTypes,
  UpdateNotificationCategory,
  UpdateNotificationType
} from './application/use-cases/notification-catalog.use-cases';
import {
  CreateExternalNotification,
  GetDelivery,
  ListDeliveries,
  SendDirectAnnouncement,
  SendGlobalAnnouncement
} from './application/use-cases/admin-notifications.use-cases';
import { SendVerificationCode, VerifyCode } from './application/use-cases/verification-codes.use-cases';
import { ProcessBounceFeed } from './application/use-cases/bounce-feed.use-case';
import { PurgeOldNotifications, PurgeVerificationCodes } from './application/use-cases/cleanup.use-cases';
import {
  BounceFeedController,
  NotificationCategoryController,
  NotificationController,
  NotificationDeliveryController,
  NotificationPreferenceController,
  NotificationTypeController,
  VerificationController
} from './presentation/http/notification.controllers';
import {
  createBounceWebhookRouter,
  createInboxRouter,
  createNotificationAdminRouter,
  createPreferenceRouter,
  type NotificationRouteGuards
} from './presentation/http/notification.routes';

export interface NotificationModuleDeps {
  audit: AuditTrail;
  logger: Logger;
  unitOfWork: UnitOfWork;
  guards: RouteGuards;
  /** Un servicio externo con X-API-Key; un webhook con la apikey en la query; marca de la operación del webhook. */
  externalGuards: { authenticateExternalService: RequestHandler; authenticateWebhook: RequestHandler; markWebhookOperation: RequestHandler };
  /** Las cuentas de iam: el contacto de un usuario y los clientes del envío masivo. */
  recipients: RecipientDirectory;
  /** Los prefijos telefónicos de catalogs. */
  phonePrefixes: PhonePrefixes;
  /** Logo de las plantillas de correo. */
  notificationLogoUrl: string | null | undefined;
  /** Proveedores simulados (fuera de producción): código OTP fijo y parcial visible. */
  mockProviders: boolean;
  /** El topic SNS del feed de rebotes; sin configurar se acepta cualquiera con firma válida. */
  bounceTopicArn: string | null | undefined;
}

export interface NotificationModule {
  /** Bandeja, contador y verificación de contacto (admin y client, /api/v1/notification). */
  inboxRouter: Router;
  /** Preferencias del titular (admin y client, /api/v1/kyc). */
  preferenceRouter: Router;
  /** Tipos, categorías y entregas (solo admin). */
  adminRouter: Router;
  /** Webhook de rebotes de SES (client). */
  webhookRouter: Router;
  /** Los puertos Notifier y EmailNotifier para los demás módulos. */
  notifier: Notifier & EmailNotifier;
  worker: NotificationWorker;
  /** El aviso en tiempo real del contador: se conecta a Redis al arrancar y se cierra al apagar. */
  unreadCounts: { initialize(): Promise<void>; close(): Promise<void> };
}

/** Los repositorios Prisma del módulo. */
function createRepositories() {
  return {
    types: new PrismaNotificationTypeRepository(),
    categories: new PrismaNotificationCategoryRepository(),
    personal: new PrismaPersonalNotificationRepository(),
    globals: new PrismaGlobalNotificationRepository(),
    deliveries: new PrismaDeliveryRepository(),
    preferences: new PrismaNotificationPreferenceRepository(),
    pushTokens: new PrismaPushTokenRepository(),
    codes: new PrismaVerificationCodeRepository()
  };
}

type Repositories = ReturnType<typeof createRepositories>;

/** El envío: canales (SES, SNS), entregas con reintentos, envío masivo y la creación de notificaciones. */
function createSending(deps: NotificationModuleDeps, repos: Repositories, unreadChannel: UnreadCountEmitter) {
  const { audit, logger, recipients } = deps;
  const { personal, globals, deliveries, preferences, pushTokens } = repos;
  const push = new SnsPushGateway();
  const unread = new UnreadCounter(personal, globals, unreadChannel, logger);
  const suppressionList = new EmailSuppressionList(new PrismaEmailSuppressionRepository(), contactCipher, audit, logger);
  const email = new SendTemplatedEmail(new SesEmailGateway(), suppressionList, audit, logger);
  const sms = new SmsSender(new SnsSmsGateway(new PrismaSmsAttemptRepository()), deps.phonePrefixes);
  const attempts = new DeliveryAttempts({
    deliveries,
    notifications: personal,
    pushTokens,
    recipients,
    push,
    email,
    sms,
    providerErrors: awsErrorClassifier,
    cipher: contactCipher,
    audit,
    logger
  });
  const broadcast = new BroadcastGlobalNotification({
    globals,
    recipients,
    preferences,
    pushTokens,
    push,
    email,
    rateLimiter: new RedisSendRateLimiter(),
    cipher: contactCipher,
    logger
  });
  const createNotification = new CreateNotification({
    types: repos.types,
    personal,
    globals,
    preferences,
    unitOfWork: deps.unitOfWork,
    transaction: transactionProbe,
    schedule: new ScheduleDeliveries(deliveries, logger),
    attempts,
    broadcast,
    unread,
    logger
  });
  const sendDirectEmail = new SendDirectEmail(repos.types, email, contactCipher, logger);
  return { unread, suppressionList, sms, attempts, broadcast, createNotification, sendDirectEmail };
}

type Sending = ReturnType<typeof createSending>;

/** Bandeja, preferencias, verificación y webhook (casos de uso de lectura y de entrada) → controllers → routers. */
function createUserRouters(deps: NotificationModuleDeps, repos: Repositories, sending: Sending, unreadChannel: UnreadCountEmitter) {
  const { audit, logger, unitOfWork } = deps;
  const { personal, globals, preferences, codes } = repos;
  const { unread } = sending;
  const guards: NotificationRouteGuards = { ...deps.guards, ...deps.externalGuards };

  const inbox = new NotificationController(
    {
      feed: new ListNotificationFeed(personal, globals, unitOfWork, unread, audit, logger),
      personal: new ListPersonalNotifications(personal, unread, audit),
      global: new ListGlobalNotifications(globals, unread, audit),
      unreadCount: new GetUnreadCount(unread, unreadChannel, audit),
      counter: unread,
      createExternal: new CreateExternalNotification(sending.createNotification, audit, logger)
    },
    unreadChannel,
    logger
  );
  const verification = new VerificationController({
    send: new SendVerificationCode({
      codes,
      generator: verificationCodeGenerator,
      directEmail: sending.sendDirectEmail,
      sms: sending.sms,
      audit,
      logger,
      mockProviders: deps.mockProviders,
      logoUrl: deps.notificationLogoUrl
    }),
    verify: new VerifyCode(codes, audit, logger)
  });
  const preference = new NotificationPreferenceController({
    get: new GetNotificationPreference(preferences, audit),
    update: new UpdateNotificationPreference(preferences, audit)
  });
  const bounces = new BounceFeedController(new ProcessBounceFeed(snsBounceFeedVerifier, sending.suppressionList, audit, logger, deps.bounceTopicArn));

  return {
    inboxRouter: createInboxRouter(inbox, verification, guards),
    preferenceRouter: createPreferenceRouter(preference, guards),
    webhookRouter: createBounceWebhookRouter(bounces, guards)
  };
}

/** Panel admin: tipos, categorías y entregas. */
function createAdminRouter(deps: NotificationModuleDeps, repos: Repositories, sending: Sending) {
  const { audit, recipients, notificationLogoUrl } = deps;
  const { types, categories, deliveries } = repos;
  const { createNotification } = sending;
  return createNotificationAdminRouter(
    {
      types: new NotificationTypeController({
        list: new ListNotificationTypes(types, audit),
        update: new UpdateNotificationType(types, categories, audit),
        sendGlobal: new SendGlobalAnnouncement(createNotification, audit, notificationLogoUrl),
        sendDirect: new SendDirectAnnouncement(recipients, createNotification, audit, notificationLogoUrl)
      }),
      categories: new NotificationCategoryController({
        list: new ListNotificationCategories(categories, audit),
        get: new GetNotificationCategory(categories, audit),
        create: new CreateNotificationCategory(categories, audit),
        update: new UpdateNotificationCategory(categories, audit),
        remove: new DeleteNotificationCategory(categories, types, audit)
      }),
      deliveries: new NotificationDeliveryController({ list: new ListDeliveries(deliveries, audit), get: new GetDelivery(deliveries, audit) })
    },
    deps.guards
  );
}

export function createNotificationModule(deps: NotificationModuleDeps): NotificationModule {
  const repos = createRepositories();
  const unreadChannel = new UnreadCountEmitter();
  const sending = createSending(deps, repos, unreadChannel);
  const { createNotification, sendDirectEmail, sms } = sending;

  // Transitorio: lo que iam y approvals usan por el index.ts
  bindLegacyNotification({ createNotification, sendDirectEmail, sms });

  return {
    ...createUserRouters(deps, repos, sending, unreadChannel),
    adminRouter: createAdminRouter(deps, repos, sending),
    notifier: {
      notify: async notification => {
        await createNotification.execute(notification);
      },
      notifyEmail: async notification => {
        await sendDirectEmail.execute(notification);
      }
    },
    worker: createNotificationWorker(
      {
        dispatchDeliveries: new DispatchDueDeliveries(repos.deliveries, sending.attempts),
        broadcast: sending.broadcast,
        purgeNotifications: new PurgeOldNotifications(repos.personal, repos.pushTokens, deps.logger),
        purgeCodes: new PurgeVerificationCodes(repos.codes, deps.logger)
      },
      deps.logger
    ),
    unreadCounts: unreadChannel
  };
}
