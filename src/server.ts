// src/server.ts — punto de entrada: conecta la infraestructura, arranca workers, levanta HTTP y apaga en orden.
import type { Server } from 'node:http';
import databaseHealth from './shared/database/database-health';
import redisClient from './shared/infra/redis.util';
import loggerUtilModule from './shared/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from './shared/constants';
const { server, workers } = constantsModule;
import errorMessageModule from './shared/utils/error-message.util';
const { errorMessage } = errorMessageModule;
import notificationModule from './modules/notification';
const { NotificationWorker, NotificationEmitter } = notificationModule;
import iamModule from './modules/iam';
const { SessionExpirationWorker } = iamModule;
import auditModule from './modules/audit';
const { AuditArchiveWorker } = auditModule;
import approvalsModule from './modules/approvals';
const { DualApprovalExpirationWorker, dualApprovalBootstrap: dualApprovalBootstrapModule } = approvalsModule;
const { registerDualApprovalHandlers } = dualApprovalBootstrapModule;
import app from './app';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function connectInfrastructure() {
  await redisClient.connect();
  if (redisClient.isAvailable()) {
    logger.info('✅ Redis conectado');
  } else {
    logger.warn('⚠️  Sin Redis (modo instancia única)');
  }

  await databaseHealth.checkDatabase();
  logger.info('✅ Base de datos conectada');

  await NotificationEmitter.initialize();
}

function startWorkers() {
  if (!workers.enabled) {
    logger.info('ℹ️  Workers deshabilitados');
    return;
  }
  NotificationWorker.iniciar();
  SessionExpirationWorker.iniciar();
  AuditArchiveWorker.iniciar();
  DualApprovalExpirationWorker.iniciar();
  logger.info('✅ Workers iniciados');
}

function listen(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const httpServer = app.listen(server.port, server.host, () => resolve(httpServer));
    httpServer.once('error', reject);
  });
}

function setupShutdown(httpServer: Server) {
  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info(`${signal} recibido — apagando...`);
    // Se registra primero: dispara aunque close() se cuelgue
    setTimeout(() => {
      logger.error('❌ Apagado forzado por timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    try {
      await new Promise<void>((resolve, reject) => {
        httpServer.close(err => (err ? reject(err) : resolve()));
      });
      await databaseHealth.closeDatabase();
      await redisClient.disconnect();
      await NotificationEmitter.close();
      logger.info('✅ Apagado completo');
      process.exit(0);
    } catch (error) {
      logger.error('❌ Error durante el apagado', { error: errorMessage(error) });
      process.exit(1);
    }
  };

  process.on('SIGTERM', signal => void shutdown(signal));
  process.on('SIGINT', signal => void shutdown(signal));

  process.on('uncaughtException', error => {
    logger.error('❌ Uncaught Exception', { message: error?.message, stack: error?.stack });
    if (server.nodeEnv === 'production') {
      process.exit(1);
    }
  });
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('❌ Unhandled Rejection', {
      reasonMessage: reason instanceof Error ? reason.message : String(reason),
      reasonStack: reason instanceof Error ? reason.stack : undefined
    });
    if (server.nodeEnv === 'production') {
      process.exit(1);
    }
  });
}

async function start() {
  try {
    logger.info(`🚀 Iniciando API (${server.nodeEnv})`);
    await connectInfrastructure();
    registerDualApprovalHandlers();
    startWorkers();
    const httpServer = await listen();
    setupShutdown(httpServer);
    logger.info(`🌐 http://${server.host}:${server.port} — docs en /admin/docs y /client/docs`);
  } catch (error) {
    logger.error('❌ No se pudo iniciar la API', {
      error: errorMessage(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
}

void start();
