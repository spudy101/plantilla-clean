import type { Request, Response, Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import getAllSchemas from './schemas';
import constantsModule from '../../shared/infrastructure/config';
const { server } = constantsModule;

// ─── Módulos KYC (compartidos con client) ─────────────────────
import authLoginPaths from '../../modules/iam/presentation/http/docs/auth-login.paths';
import catalogPaths from '../../modules/catalogs/presentation/http/docs/catalogs.paths';
import profilePaths from '../../modules/person/presentation/http/docs/profile.paths';
import mfaPaths from '../../modules/iam/presentation/http/docs/mfa.paths';

// ─── Módulos Notification (compartidos con client) ────────────
import notificationSharedPaths from '../../modules/notification/presentation/http/docs/notification.paths';
import notificationPreferencePaths from '../../modules/notification/presentation/http/docs/notification-preference.paths';
import sendVerificationPaths from '../../modules/notification/presentation/http/docs/send-verification.paths';

// ─── Módulos Admin — Privacidad ───────────────────────────────
import privacyPolicyPaths from '../../modules/legal/presentation/http/docs/privacy-policy-admin.paths';

// ─── Módulos Admin — KYC ──────────────────────────────────────
import personPaths from '../../modules/person/presentation/http/docs/admin-person.paths';
import notificationTypePaths from '../../modules/notification/presentation/http/docs/notification-type.paths';

// ─── Módulos Admin — Auditoría ────────────────────────────────
import adminAuthSessionPaths from '../../modules/iam/presentation/http/docs/admin-auth-session.paths';
import changeLogPaths from '../../modules/audit/presentation/http/docs/change-log.paths';
import auditLogPaths from '../../modules/audit/presentation/http/docs/audit-log.paths';
import auditAlertPaths from '../../modules/audit/presentation/http/docs/audit-alert.paths';
import auditActionCatalogPaths from '../../modules/audit/presentation/http/docs/audit-action-catalog.paths';
import sessionTracePaths from '../../modules/audit/presentation/http/docs/session-trace.paths';
import operationPaths from '../../modules/audit/presentation/http/docs/operation.paths';
import integrationMonitoringPaths from '../../modules/integration/presentation/http/docs/integration-monitoring.paths';
import notificationDeliveryPaths from '../../modules/notification/presentation/http/docs/notification-delivery.paths';
import notificationCategoryPaths from '../../modules/notification/presentation/http/docs/notification-category.paths';

// ─── Módulos Admin — Consentimientos ──────────────────────────
import consentTypePaths from '../../modules/legal/presentation/http/docs/consent-type.paths';
import userConsentAuditPaths from '../../modules/legal/presentation/http/docs/admin-user-consent.paths';

// ─── Módulos Admin — Configuración global ─────────────────────
import systemGlobalConfigPaths from '../../modules/settings/presentation/http/docs/system-global-config.paths';

// ─── Módulos Admin — Banners promocionales ────────────────────
import promotionalBannerAdminPaths from '../../modules/banners/presentation/http/docs/admin-promotional-banner.paths';

// ─── Módulos Admin — Usuarios internos & RBAC ─────────────────
import adminUserPaths from '../../modules/iam/presentation/http/docs/admin-user.paths';
import adminRbacPaths from '../../modules/iam/presentation/http/docs/admin-rbac.paths';

// ─── Módulos Admin — Doble aprobación global (maker-checker) ──
import approvalRequestPaths from '../../modules/approvals/presentation/http/docs/approval-request.paths';

// ─── Merge paths ──────────────────────────────────────────────

const allPaths = {
  ...authLoginPaths.paths,
  ...catalogPaths.paths,
  ...profilePaths.paths,
  ...mfaPaths.paths,
  ...notificationSharedPaths.paths,
  ...notificationPreferencePaths.paths,
  ...sendVerificationPaths.paths,
  ...privacyPolicyPaths.paths,
  ...personPaths.paths,
  ...notificationTypePaths.paths,
  ...adminAuthSessionPaths.paths,
  ...changeLogPaths.paths,
  ...auditLogPaths.paths,
  ...auditAlertPaths.paths,
  ...auditActionCatalogPaths.paths,
  ...sessionTracePaths.paths,
  ...operationPaths.paths,
  ...integrationMonitoringPaths.paths,
  ...notificationDeliveryPaths.paths,
  ...notificationCategoryPaths.paths,
  ...consentTypePaths.paths,
  ...userConsentAuditPaths.paths,
  ...systemGlobalConfigPaths.paths,
  ...promotionalBannerAdminPaths.paths,
  ...adminUserPaths.paths,
  ...adminRbacPaths.paths,
  ...approvalRequestPaths.paths
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
  ...privacyPolicyPaths.schemas,
  ...personPaths.schemas,
  ...notificationTypePaths.schemas,
  ...adminAuthSessionPaths.schemas,
  ...changeLogPaths.schemas,
  ...consentTypePaths.schemas,
  ...userConsentAuditPaths.schemas,
  ...auditLogPaths.schemas,
  ...auditAlertPaths.schemas,
  ...auditActionCatalogPaths.schemas,
  ...sessionTracePaths.schemas,
  ...operationPaths.schemas,
  ...integrationMonitoringPaths.schemas,
  ...notificationDeliveryPaths.schemas,
  ...notificationCategoryPaths.schemas,
  ...systemGlobalConfigPaths.schemas,
  ...promotionalBannerAdminPaths.schemas,
  ...adminUserPaths.schemas,
  ...adminRbacPaths.schemas,
  ...approvalRequestPaths.schemas
};

// ─── Ensamblador ──────────────────────────────────────────────

const swaggerAdminDocs = (app: Router) => {
  const { port: PORT, nodeEnv: NODE_ENV, host: HOST } = server;

  const servers =
    NODE_ENV === 'production'
      ? [{ url: 'https://example.com/admin', description: 'Producción - Admin API' }]
      : [{ url: `http://${HOST}:${PORT}/admin`, description: 'Desarrollo - Admin API' }];

  const swaggerSpec = {
    openapi: '3.0.0',
    info: {
      title: 'Base Project - Admin API',
      version: '1.0.0',
      description: `
## Documentación de la API de Administración

Esta API permite a los administradores (\`admin\` / \`super_admin\`):
- 🔐 Autenticarse y gestionar sesión
- 👥 Gestionar personas y perfiles
- 🔔 Administrar tipos de notificación y enviar notificaciones globales
- 📋 Consultar bitácora de cambios
- 🔍 Consultar y exportar logs de auditoría (CSV/XLSX) — solo lectura, append-only
- 🧭 Trazabilidad por sesión (qué hizo cada usuario en cada sesión)
- 🔔 Gestionar alertas de auditoría
- 📄 Publicar versiones de la política de privacidad
- 👔 Gestionar usuarios internos (crear, asignar rol, activar/desactivar)
- 🔑 Administrar permisos RBAC en runtime
- ✅ Doble aprobación global (maker-checker)

⚠️ **Nota:** Todos los endpoints requieren autenticación. Los endpoints de gestión de usuarios y RBAC requieren permiso sobre el módulo \`ADMIN\`.
      `.trim(),
      contact: { name: 'Soporte Admin', email: 'admin@example.com' },
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
        timestampAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-timestamp',
          description: 'Timestamp para prevenir replay attacks. **Solo requerido en producción** (ventana de 10 segundos).'
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
    security: [{ bearerAuth: [] }, { idTokenAuth: [] }, { timestampAuth: [] }],
    paths: allPaths
  };

  const swaggerUiOptions = {
    explorer: true,
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info { margin: 20px 0; }
      .swagger-ui .scheme-container { margin: 20px 0; }
      .swagger-ui .info .title { color: #d32f2f; }
    `,
    customSiteTitle: 'Admin API',
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

  // 3. JSON del spec
  app.get('/docs.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  console.log(`📚 [ADMIN] Swagger Docs: http://${HOST}:${PORT}/admin/docs`);
};

export default swaggerAdminDocs;
