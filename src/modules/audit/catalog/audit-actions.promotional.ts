// ================================================================
// CONTENIDO PROMOCIONAL — banners de la landing y la app cliente
// Rutas:    modules/admin/core (mantenedor) · modules/shared-endpoints/core (lectura pública)
// Módulos:  admin (mantenedor) · client (lectura pública)
// Services: promotional-banner (admin y shared-endpoints)
// ================================================================

import auditCatalogModule from './audit-catalog';
const { AUDIT_CATEGORIES, AUDIT_RISKS, AUDIT_MODULES } = auditCatalogModule;

export default {
  PROMOTIONAL_BANNERS_VIEWED_ADMIN: {
    description: 'Banners promocionales consultados desde el mantenedor admin',
    category: AUDIT_CATEGORIES.CONFIGURATION,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.LOW
  },
  PROMOTIONAL_BANNERS_UPDATED: {
    description: 'Banners promocionales actualizados (contenido publicado al front)',
    category: AUDIT_CATEGORIES.CONFIGURATION,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.MEDIUM
  },
  PROMOTIONAL_BANNER_IMAGE_UPLOADED: {
    description: 'Imagen de banner promocional subida al bucket público',
    category: AUDIT_CATEGORIES.CONFIGURATION,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.MEDIUM
  },
  PROMOTIONAL_BANNERS_PUBLIC_VIEWED: {
    description: 'Banners promocionales consultados por el front público/cliente',
    category: AUDIT_CATEGORIES.CATALOGS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  }
};
