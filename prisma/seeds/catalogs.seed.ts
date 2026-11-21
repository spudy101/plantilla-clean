// prisma/seeds/catalogs.seed.ts
//
// Catálogos chicos con clave natural única: géneros (name), tipos de documento (code), roles del RBAC
// (name) y tipos de consentimiento (code). `createMany({ skipDuplicates })` = INSERT … ON CONFLICT DO
// NOTHING: lo que ya existe no se toca.
import constantsModule from '../../src/shared/constants';
import { reportCreated, type SeedClient } from './seed-client';

const { RBAC_ROLES } = constantsModule;

const GENDERS = ['Masculino', 'Femenino', 'No binario', 'Prefiero no decir'];

// SYSTEM no se muestra al cliente: es el tipo de los usuarios internos (prisma/seeds/internal-users.seed.ts)
const DOCUMENT_TYPES = [
  { code: 'CC', name: 'Cédula de Ciudadanía', isVisibleToClient: true },
  { code: 'CE', name: 'Cédula de Extranjería', isVisibleToClient: true },
  { code: 'TI', name: 'Tarjeta de Identidad', isVisibleToClient: true },
  { code: 'PA', name: 'Pasaporte', isVisibleToClient: true },
  { code: 'PPT', name: 'Permiso de Protección Temporal', isVisibleToClient: true },
  { code: 'PEP', name: 'Permiso Especial de Permanencia', isVisibleToClient: true },
  { code: 'SYSTEM', name: 'Usuario de Sistema', isVisibleToClient: false }
];

// RF-ADM-01 — los 4 roles del RBAC
const ROLE_DESCRIPTIONS: Record<string, string> = {
  [RBAC_ROLES.SUPERADMIN]: 'Superadministrador — acceso total; omite la doble aprobación',
  [RBAC_ROLES.ADMIN]: 'Administrador — acceso total; sujeto a doble aprobación',
  [RBAC_ROLES.AUDITOR]: 'Auditor — solo lectura en todos los módulos',
  [RBAC_ROLES.CLIENTE]: 'Cliente externo'
};

// PRIVACY_POLICY es el documento único obligatorio (Política de Privacidad + Términos y Condiciones +
// Tratamiento de Datos). COMUNICACIONES_COMERCIALES es el consentimiento opcional de marketing
// (revocable). Agrega aquí los consentimientos propios de tu dominio.
const CONSENT_TYPES = [
  {
    code: 'PRIVACY_POLICY',
    name: 'Política de Privacidad, Términos y Condiciones y Tratamiento de Datos',
    description:
      'Autorización de tratamiento de datos personales (Ley 1581/2012 y Decreto 1377/2013). ' +
      'Este documento único cubre la Política de Privacidad, los Términos y Condiciones de uso ' +
      'del servicio, y el tratamiento de datos personales.',
    scope: 'ONBOARDING',
    isMandatory: true,
    isRevocable: false
  },
  {
    code: 'COMUNICACIONES_COMERCIALES',
    name: 'Comunicaciones Comerciales y Marketing',
    description:
      'Autorización para recibir comunicaciones comerciales, promociones y notificaciones de ' +
      'marketing por parte de la entidad. Es opcional y puede revocarse en cualquier momento.',
    scope: 'ONBOARDING',
    isMandatory: false,
    isRevocable: true
  }
];

export async function seedCatalogs(db: SeedClient): Promise<void> {
  const genders = await db.gender.createMany({ data: GENDERS.map(name => ({ name })), skipDuplicates: true });
  reportCreated('Géneros', genders.count, GENDERS.length);

  const documentTypes = await db.documentType.createMany({ data: DOCUMENT_TYPES, skipDuplicates: true });
  reportCreated('Tipos de documento', documentTypes.count, DOCUMENT_TYPES.length);

  const roleNames = Object.values(RBAC_ROLES) as string[];
  const roles = await db.role.createMany({
    data: roleNames.map(name => ({ name, description: ROLE_DESCRIPTIONS[name] ?? null })),
    skipDuplicates: true
  });
  reportCreated('Roles RBAC', roles.count, roleNames.length);

  const consentTypes = await db.consentType.createMany({ data: CONSENT_TYPES, skipDuplicates: true });
  reportCreated('Tipos de consentimiento', consentTypes.count, CONSENT_TYPES.length);
}
