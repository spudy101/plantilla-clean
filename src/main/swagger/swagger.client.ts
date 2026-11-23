import type { Request, Response, Router } from 'express';
// config/swagger.client.ts

import swaggerUi from 'swagger-ui-express';
import getAllSchemas from './schemas';
import constantsModule from '../../shared/infrastructure/config';
const { server } = constantsModule;

// ─── Módulos KYC (compartidos con admin) ──────────────────────
import authLoginPaths from '../../modules/iam/docs/auth-login.paths';
import catalogPaths from '../../modules/catalogs/presentation/http/docs/catalogs.paths';
import profilePaths from '../../modules/person/docs/profile.paths';
import mfaPaths from '../../modules/iam/docs/mfa.paths';

// ─── Módulos Notification (compartidos con admin) ─────────────
import notificationSharedPaths from '../../modules/notification/docs/notification.paths';
import notificationPreferencePaths from '../../modules/notification/docs/notification-preference.paths';

// ─── Módulos Client ───────────────────────────────────────────
import authRegisterPaths from '../../modules/iam/docs/auth-register.paths';
import sendVerificationPaths from '../../modules/notification/docs/send-verification.paths';
import authBiometricPaths from '../../modules/iam/docs/auth-biometric.paths';
import personReferencePaths from '../../modules/person/docs/person-reference.paths';

// ─── Módulos Client — Consentimientos ─────────────────────────
import userConsentPaths from '../../modules/legal/presentation/http/docs/user-consent.paths';

// ─── Módulos Client — Actividad reciente del usuario ──────────
import userActivityPaths from '../../modules/audit/presentation/http/docs/user-activity.paths';

// ─── Módulos Client — Banners promocionales (público) ─────────
import promotionalBannerPublicPaths from '../../modules/banners/presentation/http/docs/promotional-banner.paths';

// ─── Merge paths ──────────────────────────────────────────────

const allPaths = {
  ...authLoginPaths.paths,
  ...catalogPaths.paths,
  ...profilePaths.paths,
  ...mfaPaths.paths,
  ...notificationSharedPaths.paths,
  ...notificationPreferencePaths.paths,
  ...sendVerificationPaths.paths,
  ...authRegisterPaths.paths,
  ...authBiometricPaths.paths,
  ...personReferencePaths.paths,
  ...userConsentPaths.paths,
  ...userActivityPaths.paths,
  ...promotionalBannerPublicPaths.paths
};

// ─── Merge schemas ─────────────────────────────────────────────

const allModuleSchemas = {
  ...authLoginPaths.schemas,
  ...catalogPaths.schemas,
  ...profilePaths.schemas,
  ...mfaPaths.schemas,
  ...notificationSharedPaths.schemas,
  ...notificationPreferencePaths.schemas,
  ...sendVerificationPaths.schemas,
  ...authRegisterPaths.schemas,
  ...authBiometricPaths.schemas,
  ...personReferencePaths.schemas,
  ...userConsentPaths.schemas,
  ...userActivityPaths.schemas,
  ...promotionalBannerPublicPaths.schemas
};

// ─── Ensamblador ──────────────────────────────────────────────

const swaggerClientDocs = (app: Router) => {
  const { port: PORT, nodeEnv: NODE_ENV, host: HOST } = server;

  const servers =
    NODE_ENV === 'production'
      ? [{ url: 'https://example.com/client', description: 'Producción - Client API' }]
      : [{ url: `http://${HOST}:${PORT}/client`, description: 'Desarrollo - Client API' }];

  const swaggerSpec = {
    openapi: '3.0.0',
    info: {
      title: 'Base Project - Client API',
      version: '1.0.0',
      description: `
## Documentación de la API de Clientes

Esta API permite a los usuarios:
- 🔐 Registrarse y autenticarse (incluyendo biométrico WebAuthn)
- 👤 Gestionar su perfil
- 🔔 Configurar notificaciones y verificar contacto (OTP)
- 🔒 Gestionar MFA (autenticación de dos factores)
- 📝 Gestionar consentimientos y ver su actividad reciente por sesión

---

## Headers de autenticación (mobile)

Los clientes **mobile** deben enviar los siguientes headers en cada request autenticado:

| Header | Requerido | Descripción |
|---|---|---|
| \`Authorization: Bearer <accessToken>\` | ✅ Siempre | Access Token |
| \`x-id-token\` | ✅ Siempre | ID Token con custom attributes |
| \`x-client-type\` | ✅ En login/register/refresh | Valor: \`mobile\` |
| \`x-timestamp\` | ⚠️ Producción | Unix ms en texto plano |
| \`x-signature\` | ⚠️ Producción | HMAC-SHA256 hex de \`timestamp:METHOD:path\` |
| \`x-device-id\` | ⚠️ Producción | \`fingerprintHash\` del dispositivo |

> **Anti-replay (producción):** el servidor verifica que el timestamp esté dentro de ±10 segundos y que la firma sea válida para el dispositivo.
      `.trim(),
      contact: { name: 'Soporte', email: 'soporte@example.com' },
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' }
    },
    servers,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access Token. Header: `Authorization: Bearer <accessToken>`'
        },
        idTokenAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-id-token',
          description: 'ID Token con custom attributes. **Requerido en todos los endpoints autenticados.**'
        },
        hmacTimestamp: {
          type: 'apiKey',
          in: 'header',
          name: 'x-timestamp',
          description: '**Solo mobile · Solo producción.** Unix ms en texto plano.'
        },
        hmacSignature: {
          type: 'apiKey',
          in: 'header',
          name: 'x-signature',
          description: '**Solo mobile · Solo producción.** HMAC-SHA256 hex de `${timestamp}:${METHOD}:${path}`.'
        },
        hmacDeviceId: {
          type: 'apiKey',
          in: 'header',
          name: 'x-device-id',
          description: '**Solo mobile · Solo producción.** `fingerprintHash` del dispositivo registrado.'
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'API Key para servicios externos. Usada en `POST /notifications`. No requiere JWT.'
        }
      },
      schemas: { ...getAllSchemas, ...allModuleSchemas }
    },
    security: [{ bearerAuth: [] }, { idTokenAuth: [] }],
    paths: allPaths
  };

  const swaggerUiOptions = {
    explorer: true,
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info { margin: 20px 0; }
      .swagger-ui .scheme-container { margin: 20px 0; }
      .swagger-ui .info .title { color: #1976d2; }
    `,
    customSiteTitle: 'Client API',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      syntaxHighlight: { activate: true, theme: 'monokai' }
    }
  };

  // 1. HTML con el spec embebido
  app.get('/docs', (_req: Request, res: Response) => {
    res.send(swaggerUi.generateHTML(swaggerSpec, swaggerUiOptions));
  });

  // 2. Assets estáticos atados a este spec
  app.use('/', swaggerUi.serveFiles(swaggerSpec, swaggerUiOptions));

  // 3. JSON del spec (Postman, herramientas externas, etc.)
  app.get('/docs.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  console.log(`📚 [CLIENT] Swagger Docs: http://${HOST}:${PORT}/client/docs`);
};

export default swaggerClientDocs;
