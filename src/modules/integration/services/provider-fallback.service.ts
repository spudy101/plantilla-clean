// Ventanas de fallback de proveedores: qué pasa cuando un circuito se abre y cuando se cierra.
//
// El circuit breaker (shared/infra) no conoce el negocio: avisa con onOpen/onClose y src/app.ts le
// conecta este servicio al arrancar.
//   onOpen  → abre una ventana en provider_fallback_events + audita PROVIDER_FALLBACK_ACTIVATED
//   onClose → cierra la ventana (duración y procesos afectados) + audita PROVIDER_FALLBACK_RESOLVED
// Cada aviso corre como su propia operación de sistema. Nunca lanza: un error se loguea.

import { runOperation } from '../../../shared/observability/operation';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import errorMessageModule from '../../../shared/utils/error-message.util';
const { errorMessage } = errorMessageModule;
import providerFallbackEventRepository from '../repositories/provider-fallback-event.repository';
import auditModule from '../../audit';
const { audit } = auditModule;
import notificationModule from '../../notification';

const MS_PER_SECOND = 1000;

// Producto del circuito → nombre del proveedor en el historial y el dashboard.
const PROVIDER_BY_PRODUCT: Record<string, string> = {
  ses: 'aws_ses',
  s3: 'aws_s3',
  sns: 'aws_sns',
  aws_sms: 'aws_sms'
};

const providerName = (product: string) => PROVIDER_BY_PRODUCT[product] ?? product;

class ProviderFallbackService {
  providerFallbackEventRepository: typeof providerFallbackEventRepository;

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las reales. */
  constructor(deps: ProviderFallbackService.Deps = {}) {
    this.providerFallbackEventRepository = deps.providerFallbackEventRepository ?? providerFallbackEventRepository;
  }

  // Funciones flecha: el breaker las recibe sueltas (registerCallbacks({ onOpen, onClose })).
  onOpen = (product: string, openedAt: number) =>
    runOperation({ source: 'system', name: 'circuit-breaker.fallback-open' }, async () => {
      try {
        const startedAt = new Date(openedAt);
        await this.providerFallbackEventRepository.openFallback({
          provider: providerName(product),
          circuitProduct: product,
          startedAt
        });
        await audit.record('PROVIDER_FALLBACK_ACTIVATED', {
          actorId: null,
          details: { provider: providerName(product), product, openedAt: startedAt.toISOString() }
        });
        logger.warn(`[ProviderFallback] Fallback activado para ${product}`);
      } catch (err) {
        logger.error('[ProviderFallback] Error registrando la apertura', { product, error: errorMessage(err) });
      }
    });

  onClose = (product: string, openedAt: number) =>
    runOperation({ source: 'system', name: 'circuit-breaker.fallback-close' }, async () => {
      try {
        const startedAt = new Date(openedAt);
        const endedAt = new Date();
        const affectedCount = await this.countAffected(product, startedAt, endedAt);
        await this.providerFallbackEventRepository.closeFallback({
          provider: providerName(product),
          startedAt,
          endedAt,
          affectedCount
        });
        await audit.record('PROVIDER_FALLBACK_RESOLVED', {
          actorId: null,
          details: {
            provider: providerName(product),
            product,
            openedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            durationSeconds: Math.round((endedAt.getTime() - startedAt.getTime()) / MS_PER_SECOND),
            affectedCount
          }
        });
        logger.info(`[ProviderFallback] Fallback resuelto para ${product}`, { affectedCount });
      } catch (err) {
        logger.error('[ProviderFallback] Error registrando el cierre', { product, error: errorMessage(err) });
      }
    });

  // Cuántos procesos fallaron durante la ventana. Solo se sabe para los productos con tabla de intentos
  // propia (hoy SMS); para el resto, null. Si la cuenta falla, también null: no frena el cierre.
  private async countAffected(product: string, startedAt: Date, endedAt: Date): Promise<number | null> {
    if (product !== 'aws_sms') {
      return null;
    }
    try {
      return await notificationModule.smsDeliveryAttemptRepository.countFailedBetween(startedAt, endedAt);
    } catch {
      return null;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace ProviderFallbackService {
  export interface Deps {
    providerFallbackEventRepository?: typeof providerFallbackEventRepository;
  }
}

export default Object.assign(new ProviderFallbackService(), { ProviderFallbackService });
