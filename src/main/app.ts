// src/main/app.ts — la aplicación Express: middlewares globales, rutas de cada audiencia y manejo de errores.
// Los módulos en Clean Architecture llegan armados desde el composition root (./container).
//
// Un solo servidor. /admin y /client separan audiencias a nivel de rutas (cada una con su Swagger y su
// serverContext, que el login usa para validar el rol), no de despliegue.
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';

import SecurityMiddleware from '../shared/presentation/http/security.middleware';
import ErrorMiddleware from '../shared/presentation/http/error.middleware';
import { operationMiddleware } from '../shared/infrastructure/observability/operation';
import { registerAuditSink } from '../shared/infrastructure/observability/audit-hook';
import { registerResilienceSource } from '../shared/infrastructure/providers/resilience-config.util';
import CircuitBreaker from '../shared/infrastructure/providers/circuit-breaker.util';
import { createContainer } from './container';
import type { Container } from './container';
import redisClient from '../shared/infrastructure/cache/redis.util';
import databaseHealth from '../shared/infrastructure/database/database-health';
import swaggerAdminDocs from './swagger/swagger.admin';
import swaggerClientDocs from './swagger/swagger.client';
import packageModule from '../../package.json';
const { version } = packageModule;

// ── Rutas compartidas (admin + client) ─────────────────────────────────────
import iamModule from '../modules/iam';
const { authLoginRoutes, mfaRoutes, adminAuthSessionRoutes, adminUserRoutes, adminRbacRoutes, authRegisterRoutes, authBiometricRoutes } = iamModule;
import notificationModule from '../modules/notification';
const { notificationPreferenceRoutes, notificationRoutes, sendVerificationRoutes, adminNotificationTypeRoutes, adminNotificationCategoryRoutes, adminNotificationDeliveryRoutes, emailBounceWebhookRoutes } = notificationModule;
// ── Rutas admin ────────────────────────────────────────────────────────────
import approvalsModule from '../modules/approvals';
const { adminApprovalRequestRoutes } = approvalsModule;
// ── Rutas client ───────────────────────────────────────────────────────────
type Audience = 'admin' | 'client';

/** Router de una audiencia: marca req.serverContext (el login valida el rol contra ella) y monta su Swagger. */
function audienceRouter(audience: Audience, container: Container) {
  const router = express.Router();
  router.use((req, _res, next) => {
    req.serverContext = audience;
    next();
  });
  (audience === 'admin' ? swaggerAdminDocs : swaggerClientDocs)(router);

  router.use('/api/v1/auth', authLoginRoutes);
  router.use('/api/v1/kyc', mfaRoutes);
  router.use('/api/v1/kyc', container.person.profileRouter);
  router.use('/api/v1/kyc', notificationPreferenceRoutes);
  router.use('/api/v1/kyc', container.catalogs.router);
  router.use('/api/v1/notification', notificationRoutes);
  router.use('/api/v1/notification', sendVerificationRoutes);
  return router;
}

function adminRouter(container: Container) {
  const router = audienceRouter('admin', container);
  router.use('/api/v1/auth', adminAuthSessionRoutes);
  router.use('/api/v1/kyc', container.person.adminRouter);
  router.use('/api/v1/kyc', adminUserRoutes);
  router.use('/api/v1/kyc', adminRbacRoutes);
  router.use('/api/v1/notification', adminNotificationTypeRoutes);
  router.use('/api/v1/notification', adminNotificationCategoryRoutes);
  router.use('/api/v1/notification', adminNotificationDeliveryRoutes);
  router.use('/api/v1/records', container.legal.adminRouter);
  router.use('/api/v1/records', container.audit.adminRouter);
  router.use('/api/v1/core', container.settings.adminRouter);
  router.use('/api/v1/core', container.banners.adminRouter);
  router.use('/api/v1/core', adminApprovalRequestRoutes);
  router.use('/api/v1/integration', container.integration.adminRouter);
  return router;
}

function clientRouter(container: Container) {
  const router = audienceRouter('client', container);
  router.use('/api/v1/auth', authRegisterRoutes);
  router.use('/api/v1/auth', authBiometricRoutes);
  router.use('/api/v1/notification', emailBounceWebhookRoutes);
  router.use('/api/v1/kyc', container.person.clientRouter);
  router.use('/api/v1/records', container.legal.clientRouter);
  router.use('/api/v1/records', container.audit.clientRouter);
  router.use('/api/v1/core', container.banners.publicRouter);
  return router;
}

/** JSON malformado del cliente → 400 controlado (no INTERNAL_ERROR ni ruido de auditoría). */
function handleMalformedJson(err: unknown, req: Request, res: Response, next: NextFunction) {
  if ((err as { type?: string } | null)?.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      code: 'INVALID_JSON_BODY',
      message: 'El cuerpo de la solicitud contiene JSON inválido. Verifica la sintaxis y el Content-Type.',
      correlationId: req.correlationId ?? null
    });
  }
  return next(err);
}

type CheckStatus = 'healthy' | 'unhealthy' | 'degraded';

/** 200 si todo está bien, 503 si una dependencia crítica (la BD) no responde. Redis caído = degradado. */
async function health(req: Request, res: Response) {
  const checks: Record<string, { status: CheckStatus; responseTimeMs?: number; note?: string }> = {};

  const dbStart = Date.now();
  try {
    await databaseHealth.checkDatabase();
    checks.database = { status: 'healthy', responseTimeMs: Date.now() - dbStart };
  } catch {
    checks.database = { status: 'unhealthy', responseTimeMs: Date.now() - dbStart };
  }
  checks.redis = redisClient.isAvailable()
    ? { status: 'healthy' }
    : { status: 'degraded', note: 'running in single-instance mode' };

  const statuses = Object.values(checks).map(c => c.status);
  const status: CheckStatus = statuses.includes('unhealthy') ? 'unhealthy' : statuses.includes('degraded') ? 'degraded' : 'healthy';

  return res.status(status === 'unhealthy' ? 503 : 200).json({
    status,
    service: 'api',
    version,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    correlationId: req.correlationId,
    checks
  });
}

function createApp(container: Container) {
  // shared/ no conoce los módulos: lo que necesita de ellos se conecta acá, una sola vez.
  //  - eventos de infraestructura que se auditan (worker caído, Redis, 401/403) → módulo audit
  //  - configuración de resiliencia (timeouts, circuit breaker) → módulo settings
  //  - qué hacer cuando un circuito se abre o se cierra (ventana de fallback + auditoría) → módulo integration
  registerAuditSink(({ action, ...input }) => container.audit.trail.record(action, { ...input, actorId: input.actorId ?? null }));
  registerResilienceSource(() => container.settings.useCases.getIntegrationResilience.execute());
  CircuitBreaker.registerCallbacks(container.integration.circuitListener);

  const app = express();

  // Detrás del ALB: la IP real y el protocolo llegan en X-Forwarded-*
  app.set('trust proxy', 1);

  // ⚠️ El orden importa
  app.use(operationMiddleware); // 1. Operación: id, contexto, fila en `operations` y log HTTP (primero)
  app.use(SecurityMiddleware.helmet()); // 2. Seguridad
  app.use(SecurityMiddleware.cors());
  app.use(SecurityMiddleware.addSecurityHeaders);
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' })); // 3. Body parsers
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(handleMalformedJson);
  app.use(compression());

  app.get('/health', health);
  app.get('/', (req, res) =>
    res.status(200).json({
      success: true,
      service: 'api',
      message: 'Base Project API',
      version,
      endpoints: { admin: '/admin', client: '/client', health: '/health' },
      docs: { admin: '/admin/docs', client: '/client/docs' },
      correlationId: req.correlationId
    })
  );

  app.use('/admin', adminRouter(container));
  app.use('/client', clientRouter(container));

  app.use(ErrorMiddleware.handleNotFound);
  app.use(ErrorMiddleware.handleError);
  return app;
}

/** Los módulos armados: server.ts inicia sus workers. */
export const container = createContainer();

export default createApp(container);
