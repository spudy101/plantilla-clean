// callProvider: la única forma de llamar a un proveedor externo (SES, S3, SNS…).
//
// Junta en un lugar lo que cada llamada necesita, en este orden:
//   circuit breaker (por producto) → reintentos con backoff → timeout por intento → una línea de log
// La línea de log es la traza de la llamada y, en producción, sus métricas en CloudWatch (EMF).
//
// Timeout y reintentos salen de settings (ResilienceConfig). Solo se reintentan, y solo abren el
// circuito, los errores transitorios (isTransientError): un error del cliente (dirección inválida,
// acceso denegado) se propaga al primer intento.
//
//   const res = await callProvider({ product: 'ses', endpoint: 'SES:SendEmailCommand' },
//     signal => sesClient.send(command, { abortSignal: signal }));

import CircuitBreaker, { CircuitOpenError } from './circuit-breaker.util';
import { isTransientError } from './provider-errors';
import ResilienceConfig from './resilience-config.util';
import retryUtilModule from './retry.util';
const { withRetry } = retryUtilModule;
import awsProviderMetaUtilModule from './aws-provider-meta.util';
const { awsErrorCode } = awsProviderMetaUtilModule;
import loggerUtilModule from '../observability/logger.util';
const { logger } = loggerUtilModule;
import errorMessageModule from '../utils/error-message.util';
import constantsModule from '../constants';
import { markExternalEffect } from '../database/transaction-context';

const { errorMessage } = errorMessageModule;

/**
 * Opciones para todo cliente del AWS SDK cuyas llamadas pasan por callProvider: `new SESClient({ ...AWS_CLIENT_OPTIONS, … })`.
 * El SDK v3 reintenta por su cuenta (3 intentos por defecto). Sumado a los reintentos de callProvider, una
 * llamada caída hacía hasta 9 intentos, con timeouts y backoff que no salían de settings. Acá reintenta solo
 * callProvider. Sin timeout en el cliente: lo pone callProvider en cada intento.
 */
const AWS_CLIENT_OPTIONS = Object.freeze({ maxAttempts: 1 });

/** Productos con circuito propio. Uno nuevo (p. ej. mercadopago) se agrega acá. */
const PROVIDER_PRODUCTS = Object.freeze(['ses', 's3', 'sns', 'aws_sms'] as const);
type ProviderProduct = (typeof PROVIDER_PRODUCTS)[number];

type CallResult = 'success' | 'failed' | 'circuit_open';

// Métricas en CloudWatch con Embedded Metric Format: la misma línea de log que sirve de traza (Logs
// Insights por correlationId) trae el bloque `_aws` y CloudWatch la convierte en métricas, sin SDK
// ni llamadas extra. Solo en producción (es donde la consola va en JSON hacia CloudWatch).
// Alarmas sugeridas: Failures/Calls por Product, Rejected > 0 (circuito abierto), Latency p99.
const METRICS_NAMESPACE = 'ProviderCalls';
const emitMetrics = constantsModule.server.nodeEnv === 'production';

function metricsBlock(product: ProviderProduct, result: CallResult, durationMs: number | null) {
  const values: Record<string, number> = {
    Calls: 1,
    Failures: result === 'failed' ? 1 : 0,
    Rejected: result === 'circuit_open' ? 1 : 0,
    ...(durationMs === null ? {} : { Latency: durationMs })
  };
  return {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: METRICS_NAMESPACE,
          Dimensions: [['Product']],
          Metrics: Object.keys(values).map(Name => ({ Name, Unit: Name === 'Latency' ? 'Milliseconds' : 'Count' }))
        }
      ]
    },
    Product: product,
    ...values
  };
}

/** Una línea por llamada: traza en CloudWatch Logs y, en producción, métricas (EMF). */
function logCall(entry: {
  product: ProviderProduct;
  endpoint: string;
  result: CallResult;
  durationMs: number | null;
  notificationId: string | null;
  error?: unknown;
}) {
  const { product, endpoint, result, durationMs, notificationId, error } = entry;
  const fields = {
    product,
    endpoint,
    result,
    durationMs,
    ...(notificationId ? { notificationId } : {}),
    ...(error === undefined ? {} : { errorCode: awsErrorCode(error), error: errorMessage(error) }),
    ...(emitMetrics ? metricsBlock(product, result, durationMs) : {})
  };
  const message = `[Provider] ${product} ${endpoint} → ${result}`;
  if (result === 'success') {
    logger.info(message, fields);
  } else {
    logger.warn(message, fields);
  }
}

interface ProviderCall {
  product: ProviderProduct;
  endpoint: string;
  /** Si la llamada es un envío de una notificación: queda en la traza para buscarla. */
  notificationId?: string | null;
}

async function callProvider<T>(call: ProviderCall, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const { product, endpoint, notificationId = null } = call;
  // Una llamada externa no se revierte con la transacción: si hay una abierta, ya no se puede repetir
  markExternalEffect();
  const { timeoutMs, maxRetries } = await ResilienceConfig.get();
  const startTime = Date.now();

  try {
    const result = await CircuitBreaker.execute(
      product,
      () => withRetry(() => fn(AbortSignal.timeout(timeoutMs)), { maxRetries, label: endpoint, shouldRetry: isTransientError }),
      { isFailure: isTransientError }
    );
    logCall({ product, endpoint, result: 'success', durationMs: Date.now() - startTime, notificationId });
    return result;
  } catch (error) {
    const circuitOpen = error instanceof CircuitOpenError;
    logCall({
      product,
      endpoint,
      result: circuitOpen ? 'circuit_open' : 'failed',
      durationMs: circuitOpen ? null : Date.now() - startTime,
      notificationId,
      error
    });
    throw error;
  }
}

export { callProvider, CircuitOpenError, AWS_CLIENT_OPTIONS, PROVIDER_PRODUCTS };
export type { ProviderProduct };
export default { callProvider, CircuitOpenError, AWS_CLIENT_OPTIONS, PROVIDER_PRODUCTS };
