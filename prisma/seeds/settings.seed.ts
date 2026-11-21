// prisma/seeds/settings.seed.ts
//
// Configuración inicial del sistema: la configuración global activa (si no hay ninguna) y la versión
// 1.0 de la política de privacidad (si no existe esa versión).
import constantsModule from '../../src/shared/infrastructure/config';
import { report, type SeedClient } from './seed-client';

const { notifications } = constantsModule;

// Banner promocional semilla para que el front tenga qué pintar tras db:reset; el admin lo reemplaza
// desde el mantenedor de banners (la imagen definitiva sube al bucket público). Es un dato JSON: sus
// claves quedan en snake_case, como las guarda el mantenedor.
const SEED_BANNER = {
  id: '9c302288-79e3-4388-9b7c-1e77262c0240',
  title: 'Bienvenido a Base Project',
  text: 'Contenido promocional de ejemplo. Edítalo desde el mantenedor de banners.',
  tag: 'Nuevo',
  button_route: '/',
  button_name: 'Explorar',
  image_url: '',
  is_active: true,
  sort_order: 1
};

export async function seedSettings(db: SeedClient): Promise<void> {
  const activeConfig = await db.systemGlobalConfig.findFirst({ where: { isActive: true }, select: { systemGlobalConfigId: true } });
  if (activeConfig) {
    report('Configuración global: ya existía');
  } else {
    await db.systemGlobalConfig.create({
      data: {
        configVersion: 1,
        isActive: true,
        currency: 'CLP',
        // Resiliencia homologada de todas las integraciones salientes. Un solo valor para todos.
        integrationResilience: {
          timeout_ms: 30000,
          max_retries: 3,
          circuit_breaker: { failure_threshold: 5, recovery_time_ms: 60000, failures_ttl_s: 300 }
        },
        promotionalBanners: [SEED_BANNER]
      }
    });
    report('Configuración global: creada');
  }

  // La URL viene de PRIVACY_POLICY_URL — generada por Terraform desde CloudFront
  const documentUrl = notifications?.ses?.privacyPolicyUrl || 'http://localhost:3000/legal/privacy-policy-v1.0.pdf';
  const { count } = await db.privacyPolicy.createMany({
    data: [
      {
        version: '1.0',
        documentUrl,
        summary: 'Versión inicial de la política de privacidad.',
        isActive: true,
        effectiveDate: new Date()
      }
    ],
    skipDuplicates: true
  });
  report(count > 0 ? `Política de privacidad v1.0: creada (${documentUrl})` : 'Política de privacidad v1.0: ya existía');
}
