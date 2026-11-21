// prisma/seeds/notifications.seed.ts
//
// Categorías de notificación (por code), tipos de notificación (por code) y la categoría de cada tipo.
// La categoría solo se asigna a los tipos que no tienen una: después se edita desde el admin
// (PATCH /notification-types/:id con notificationCategoryId) y el seed no la vuelve a tocar.
// Única excepción a "no modificar lo existente": los templates de los tipos, que son del seed.
import constantsModule from '../../src/shared/constants';
import { buildLayout, NOTIFICATION_CATEGORIES } from './data/notification-categories';
import { adminApprovalTypes } from './notification-types/admin-approvals';
import { adminAuditTypes } from './notification-types/admin-audit';
import { adminIamTypes } from './notification-types/admin-iam';
import { adminKycTypes } from './notification-types/admin-kyc';
import { clientKycTypes } from './notification-types/client-kyc';
import { sharedKycTypes } from './notification-types/shared-kyc';
import { report, reportCreated, type SeedClient } from './seed-client';

const { notifications } = constantsModule;

/** code de categoría → códigos de tipo que le pertenecen. */
const CATEGORY_BY_TYPE: Record<string, string[]> = {
  SECURITY: [
    'AUTH_SESSION_REVOKED_CLIENT',
    'AUTH_SESSION_REVOKED_INTERNAL',
    'IAM_INTERNAL_USER_SESSIONS_CLOSED',
    'LOGOUT_ALL',
    'NUEVO_DISPOSITIVO_DETECTADO',
    'PASSWORD_UPDATED',
    'PASSWORD_RESET_ADMIN',
    'RESET_PASSWORD',
    'SOLICITUD_RESET_PASSWORD',
    'RESET_MFA',
    'SOLICITUD_RESET_MFA',
    'TOTP_ACTIVADO',
    'TOTP_ELIMINADO',
    'SMS_MFA_ACTIVADO',
    'SMS_MFA_DESACTIVADO',
    'BIOMETRIC_CREDENTIAL_REGISTERED',
    'CODIGO_VERIFICACION',
    'ACCOUNT_BLOCKED',
    'EMAIL_CHANGED_NEW',
    'EMAIL_CHANGED_OLD',
    'NATIONAL_ID_CHANGED'
  ],
  ACCOUNT: [
    'BIENVENIDA',
    'ACCOUNT_ACTIVATED',
    'ACCOUNT_DEACTIVATED',
    'CUENTA_ELIMINADA',
    'PROFILE_UPDATED',
    'EMAIL_UPDATED',
    'PHONE_UPDATED',
    'NATIONAL_ID_UPDATED',
    'USUARIO_CREADO_ADMIN',
    'PRIVACY_POLICY_UPDATE',
    'ROL_CHANGE'
  ],
  // Aprobadores maker-checker de otros dominios: agregarlos acá
  TRANSACTIONAL: ['RBAC_SECOND_APPROVER', 'DUAL_APPROVAL_RESOLVED'],
  COMMERCIAL: ['NOTIFICACION_GENERAL'],
  SYSTEM_ADMIN: [
    'AUDIT_ALERT_ACKNOWLEDGED',
    'AUDIT_ALERTS_BULK_ACKNOWLEDGED',
    'CONSENT_TYPE_ADMIN_ACTION',
    'PERSON_ADMIN_ACTION',
    'IAM_ADMIN_ROLE_CHANGED',
    'IAM_ADMIN_STATUS_CHANGED',
    'IAM_ADMIN_USER_CREATED',
    'IAM_INTERNAL_USER_ACTIVATED',
    'IAM_INTERNAL_USER_CREATED',
    'IAM_INTERNAL_USER_DEACTIVATED',
    'IAM_INTERNAL_USER_ROLE_CHANGED',
    'IAM_RBAC_PERMISSION_GRANTED',
    'IAM_RBAC_PERMISSION_REVOKED'
  ]
};

export async function seedNotifications(db: SeedClient): Promise<void> {
  const categories = await db.notificationCategory.createMany({
    data: NOTIFICATION_CATEGORIES.map(({ accent, ...category }) => ({ ...category, emailLayoutTemplate: buildLayout(accent) })),
    skipDuplicates: true
  });
  reportCreated('Categorías de notificación', categories.count, NOTIFICATION_CATEGORIES.length);

  const logo = notifications?.ses?.logoUrl || 'https://via.placeholder.com/150';
  const types = [
    ...sharedKycTypes(logo),
    ...clientKycTypes(),
    ...adminKycTypes(),
    ...adminIamTypes(),
    ...adminAuditTypes(),
    ...adminApprovalTypes()
  ];
  const created = await db.notificationType.createMany({ data: types, skipDuplicates: true });
  reportCreated('Tipos de notificación', created.count, types.length);

  // Los templates son del seed (la API no los edita: admin-notification-type.validator): si cambiaron
  // acá, se actualizan en la base. Nombre, descripción, estado y categoría son del admin.
  const stored = new Map(
    (
      await db.notificationType.findMany({
        where: { code: { in: types.map(t => t.code) } },
        select: { code: true, titleTemplate: true, bodyTemplate: true, emailSubjectTemplate: true, emailBodyTemplate: true }
      })
    ).map(t => [t.code, t])
  );
  let refreshed = 0;
  for (const type of types) {
    const current = stored.get(type.code);
    const templates = {
      titleTemplate: type.titleTemplate,
      bodyTemplate: type.bodyTemplate,
      emailSubjectTemplate: type.emailSubjectTemplate,
      emailBodyTemplate: type.emailBodyTemplate
    };
    const changed = current && (Object.keys(templates) as (keyof typeof templates)[]).some(k => current[k] !== templates[k]);
    if (changed) {
      await db.notificationType.update({ where: { code: type.code }, data: templates });
      refreshed++;
    }
  }
  if (refreshed > 0) {
    report(`Tipos de notificación: templates actualizados en ${refreshed}`);
  }

  let assigned = 0;
  for (const [categoryCode, typeCodes] of Object.entries(CATEGORY_BY_TYPE)) {
    const category = await db.notificationCategory.findUnique({
      where: { code: categoryCode },
      select: { notificationCategoryId: true }
    });
    if (!category) {
      continue;
    }
    const { count } = await db.notificationType.updateMany({
      where: { code: { in: typeCodes }, notificationCategoryId: null },
      data: { notificationCategoryId: category.notificationCategoryId }
    });
    assigned += count;
  }
  if (assigned > 0) {
    report(`Tipos de notificación: ${assigned} asignados a su categoría`);
  }
}
