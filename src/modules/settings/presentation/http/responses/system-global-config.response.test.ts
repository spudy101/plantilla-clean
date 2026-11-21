// Conformidad: la salida de los casos de uso cumple el esquema que documenta Swagger. Si alguien agrega un
// campo a la salida y no al esquema (o al revés), esto falla.
import { SystemGlobalConfig as SystemGlobalConfigSchema } from './system-global-config.response';
import { toSystemGlobalConfigOutput } from '../../../application/dto/system-global-config.output';
import { SystemGlobalConfig } from '../../../domain/system-global-config';
import { IntegrationResilience } from '../../../domain/integration-resilience';

const config = (resilience: IntegrationResilience) =>
  SystemGlobalConfig.restore({
    id: '6f1f0a7e-3b8a-4d63-9a59-2f0c2b9b1c11',
    version: 3,
    currency: 'CLP',
    auditRetention: { hotYears: 5, coldYears: 10, hotPurgeEnabled: false },
    integrationResilience: resilience
  });

describe('SystemGlobalConfig — salida conforme al esquema', () => {
  it.each([
    [
      'resiliencia completa',
      IntegrationResilience.of({
        timeoutMs: 1000,
        maxRetries: 3,
        circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 60000, failuresTtlS: 300 }
      })
    ],
    ['resiliencia parcial', IntegrationResilience.of({ timeoutMs: 1000 })],
    ['sin resiliencia', IntegrationResilience.of()]
  ])('%s', (_name, resilience) => {
    const output = toSystemGlobalConfigOutput(config(resilience));
    expect(SystemGlobalConfigSchema.strict().parse(output)).toEqual(output);
  });
});
