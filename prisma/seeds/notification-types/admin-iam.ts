// prisma/seeds/notification-types/admin-iam.ts
//
// Tipos de notificación generados por acciones del módulo admin/iam.
// Cubre gestión de usuarios internos (empleados) y cambios en la matriz RBAC.
//
// Criterios de canal:
//   Empleado afectado → push + email cuando la acción altera su acceso o datos de cuenta.
//   Interno (admin que ejecutó) → push + email urgente en todas las operaciones IAM
//   porque cualquier cambio de acceso debe quedar trazado y confirmado.
//
// Datos del seed (prisma/seeds/notification-types.seed.ts): solo se insertan los códigos que faltan.

import type { NotificationTypeSeed } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const _base = (title: string, bodyHtml: string) => `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
        <tr><td style="background:#1a56db;padding:24px 32px;text-align:center">
          <img src="{{logoUrl}}" alt="Logo" height="40" style="display:block;margin:0 auto">
        </td></tr>
        <tr><td style="padding:32px">${bodyHtml}</td></tr>
        <tr><td style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb">
          <p style="margin:0;color:#9ca3af;font-size:12px">Este es un mensaje automático. Por favor no respondas a este correo.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

// ── Templates — empleado afectado ─────────────────────────────────────────────

const CREATED_EMPLOYEE_EMAIL = _base(
  'Bienvenido al equipo Base Project',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">¡Bienvenido, {{nombre}}!</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">
    Un administrador ha creado tu cuenta de acceso al panel interno de Base Project.
    Tus credenciales temporales son:
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;border-radius:6px;margin:0 0 24px">
    <tr><td style="padding:16px 20px">
      <p style="margin:0 0 8px;font-size:14px;color:#374151"><strong>Email:</strong> {{email}}</p>
      <p style="margin:0;font-size:14px;color:#374151"><strong>Contraseña temporal:</strong>
        <span style="font-family:monospace;background:#fff;padding:2px 8px;border-radius:4px;border:1px solid #d1d5db">{{passwordTemporal}}</span>
      </p>
    </td></tr>
  </table>
  <p style="color:#dc2626;font-size:14px;font-weight:600;margin:0 0 12px">
    Por seguridad, cambia tu contraseña en el primer inicio de sesión.
  </p>
  <p style="color:#6b7280;font-size:13px;margin:0">
    Si tienes dudas, contacta al equipo de administración.
  </p>`
);

const ROLE_CHANGED_EMPLOYEE_EMAIL = _base(
  'Tu rol fue actualizado',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">Hola {{nombre}},</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">
    Tu rol en el panel interno de Base Project fue actualizado.
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;border-radius:6px;margin:0 0 24px">
    <tr><td style="padding:16px 20px">
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase">Rol anterior</p>
      <p style="margin:0 0 12px;font-size:15px;color:#374151">{{rolAnterior}}</p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase">Nuevo rol</p>
      <p style="margin:0;font-size:15px;font-weight:700;color:#1a56db">{{nuevoRol}}</p>
    </td></tr>
  </table>
  <p style="color:#374151;font-size:14px;margin:0">
    Tu acceso al sistema ha sido actualizado. Si tienes preguntas sobre tus nuevos permisos,
    contacta al equipo de administración.
  </p>`
);

const ACTIVATED_EMPLOYEE_EMAIL = _base(
  'Tu cuenta fue activada',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">Hola {{nombre}},</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0">
    Tu cuenta en el panel interno de Base Project ha sido <strong>activada</strong>.
    Ya puedes iniciar sesión y acceder al sistema.
  </p>`
);

const DEACTIVATED_EMPLOYEE_EMAIL = _base(
  'Tu cuenta fue desactivada',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">Hola {{nombre}},</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">
    Tu cuenta en el panel interno de Base Project ha sido <strong>desactivada temporalmente</strong>.
    Tu acceso al sistema ha sido suspendido.
  </p>
  <p style="color:#374151;font-size:14px;margin:0">
    Si consideras que esto es un error, comunícate con el equipo de administración.
  </p>`
);

// ── Templates — admin que ejecutó (interno) ───────────────────────────────────

const ADMIN_USER_CREATED_EMAIL = _base(
  'Usuario interno creado',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">Acción completada</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">
    Has creado un nuevo usuario interno en Base Project.
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;border-radius:6px;margin:0 0 24px">
    <tr><td style="padding:16px 20px">
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase">Nuevo usuario</p>
      <p style="margin:0 0 12px;font-size:15px;color:#374151;font-weight:600">{{nombreUsuario}}</p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase">Email</p>
      <p style="margin:0;font-size:14px;color:#374151">{{email}}</p>
    </td></tr>
  </table>
  <p style="color:#6b7280;font-size:13px;margin:0">
    El usuario fue creado con rol PENDIENTE_ASIGNACION. Recuerda asignarle su rol definitivo.
  </p>`
);

const ADMIN_ROLE_CHANGED_EMAIL = _base(
  'Rol de usuario modificado',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">Acción completada</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">
    Has modificado el rol de un usuario interno.
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;border-radius:6px;margin:0 0 24px">
    <tr><td style="padding:16px 20px">
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase">Usuario</p>
      <p style="margin:0 0 12px;font-size:15px;color:#374151;font-weight:600">{{nombreUsuario}}</p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase">Rol anterior</p>
      <p style="margin:0 0 12px;font-size:14px;color:#374151">{{rolAnterior}}</p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase">Nuevo rol</p>
      <p style="margin:0;font-size:15px;font-weight:700;color:#1a56db">{{nuevoRol}}</p>
    </td></tr>
  </table>
  <p style="color:#374151;font-size:13px;margin:0">
    Las sesiones activas del usuario fueron cerradas automáticamente para aplicar el cambio de inmediato.
  </p>`
);

const ADMIN_STATUS_CHANGED_EMAIL = _base(
  'Estado de usuario modificado',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">Acción completada</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">
    Has <strong>{{accion}}</strong> la cuenta de un usuario interno.
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;border-radius:6px;margin:0 0 16px">
    <tr><td style="padding:16px 20px">
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase">Usuario</p>
      <p style="margin:0;font-size:15px;color:#374151;font-weight:600">{{nombreUsuario}}</p>
    </td></tr>
  </table>`
);

const RBAC_GRANTED_EMAIL = _base(
  'Permiso RBAC otorgado',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">Acción de seguridad completada</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">
    Has otorgado un permiso adicional en la matriz RBAC.
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;border-radius:6px;margin:0 0 16px">
    <tr><td style="padding:16px 20px">
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase">Rol</p>
      <p style="margin:0 0 12px;font-size:15px;color:#374151;font-weight:600">{{roleName}}</p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase">Módulo</p>
      <p style="margin:0 0 12px;font-size:14px;color:#374151">{{moduleName}}</p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase">Acción</p>
      <p style="margin:0;font-size:14px;color:#374151">{{action}}</p>
    </td></tr>
  </table>
  <p style="color:#dc2626;font-size:13px;font-weight:600;margin:0">
    El cambio fue aplicado de inmediato en la caché de permisos.
  </p>`
);

const RBAC_REVOKED_EMAIL = _base(
  'Permiso RBAC revocado',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">Acción de seguridad completada</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">
    Has revocado un permiso de la matriz RBAC.
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7f7;border-left:4px solid #dc2626;border-radius:4px;margin:0 0 16px">
    <tr><td style="padding:16px 20px">
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase">Rol</p>
      <p style="margin:0 0 12px;font-size:15px;color:#374151;font-weight:600">{{roleName}}</p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase">Módulo</p>
      <p style="margin:0 0 12px;font-size:14px;color:#374151">{{moduleName}}</p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase">Acción</p>
      <p style="margin:0;font-size:14px;color:#374151">{{action}}</p>
    </td></tr>
  </table>
  <p style="color:#dc2626;font-size:13px;font-weight:600;margin:0">
    El cambio fue aplicado de inmediato en la caché de permisos.
  </p>`
);

// ── Seeder ────────────────────────────────────────────────────────────────────

export function adminIamTypes(): NotificationTypeSeed[] {
  return [
    // ── AL EMPLEADO AFECTADO ───────────────────────────────────────────────

    {
      code: 'IAM_INTERNAL_USER_CREATED',
      name: 'Cuenta interna creada — bienvenida al empleado',
      description: 'Email al nuevo empleado con sus credenciales temporales cuando un admin crea su cuenta interna.',
      titleTemplate: '¡Bienvenido al equipo, {{nombre}}!',
      bodyTemplate:
        'Un administrador ha creado tu cuenta interna en Base Project. Revisa tu correo para obtener tus credenciales de acceso.',
      emailSubjectTemplate: 'Bienvenido a Base Project — tus credenciales de acceso',
      emailBodyTemplate: CREATED_EMPLOYEE_EMAIL
    },
    {
      code: 'IAM_INTERNAL_USER_ROLE_CHANGED',
      name: 'Rol de empleado actualizado — aviso al empleado',
      description: 'Push + email al empleado cuando un admin modifica su rol. Su acceso al sistema cambia de inmediato.',
      titleTemplate: 'Tu rol fue actualizado a {{nuevoRol}}',
      bodyTemplate:
        'Tu rol en Base Project cambió de {{rolAnterior}} a {{nuevoRol}}. Tu sesión fue cerrada para aplicar el cambio.',
      emailSubjectTemplate: 'Tu rol en Base Project fue actualizado',
      emailBodyTemplate: ROLE_CHANGED_EMPLOYEE_EMAIL
    },
    {
      code: 'IAM_INTERNAL_USER_ACTIVATED',
      name: 'Cuenta interna activada — aviso al empleado',
      description: 'Push + email al empleado cuando un admin activa su cuenta.',
      titleTemplate: 'Tu cuenta fue activada',
      bodyTemplate: 'Tu cuenta en el panel interno de Base Project ha sido activada. Ya puedes iniciar sesión.',
      emailSubjectTemplate: 'Tu cuenta de Base Project fue activada',
      emailBodyTemplate: ACTIVATED_EMPLOYEE_EMAIL
    },
    {
      code: 'IAM_INTERNAL_USER_DEACTIVATED',
      name: 'Cuenta interna desactivada — aviso al empleado',
      description: 'Push + email al empleado cuando un admin desactiva su cuenta. Sus sesiones son cerradas automáticamente.',
      titleTemplate: 'Tu cuenta fue desactivada',
      bodyTemplate:
        'Tu cuenta en el panel interno de Base Project ha sido desactivada. Contacta a soporte si crees que es un error.',
      emailSubjectTemplate: 'Tu cuenta de Base Project fue desactivada',
      emailBodyTemplate: DEACTIVATED_EMPLOYEE_EMAIL
    },
    {
      code: 'IAM_INTERNAL_USER_SESSIONS_CLOSED',
      name: 'Sesiones cerradas por admin — aviso al empleado',
      description: 'Push al empleado cuando un admin cierra todas sus sesiones activas.',
      titleTemplate: 'Tus sesiones fueron cerradas',
      bodyTemplate:
        'Un administrador ha cerrado todas tus sesiones activas en Base Project. Vuelve a iniciar sesión cuando lo necesites.',
      emailSubjectTemplate: null,
      emailBodyTemplate: null
    },

    // ── AL ADMIN QUE EJECUTÓ (INTERNO) ────────────────────────────────────

    {
      code: 'IAM_ADMIN_USER_CREATED',
      name: 'Usuario interno creado — confirmación al admin',
      description: 'Push + email urgente al admin que creó un nuevo usuario interno.',
      titleTemplate: 'Usuario interno creado: {{nombreUsuario}}',
      bodyTemplate:
        'Has creado el usuario interno {{nombreUsuario}} ({{email}}) exitosamente. Recuerda asignarle su rol definitivo.',
      emailSubjectTemplate: 'Confirmación: nuevo usuario interno creado en Base Project',
      emailBodyTemplate: ADMIN_USER_CREATED_EMAIL
    },
    {
      code: 'IAM_ADMIN_ROLE_CHANGED',
      name: 'Rol de usuario modificado — confirmación al admin',
      description: 'Push + email urgente al admin que modificó el rol de un usuario interno.',
      titleTemplate: 'Rol actualizado: {{nombreUsuario}} → {{nuevoRol}}',
      bodyTemplate:
        'Has actualizado el rol de {{nombreUsuario}} de {{rolAnterior}} a {{nuevoRol}}. Sus sesiones fueron cerradas.',
      emailSubjectTemplate: 'Confirmación: rol de usuario interno actualizado',
      emailBodyTemplate: ADMIN_ROLE_CHANGED_EMAIL
    },
    {
      code: 'IAM_ADMIN_STATUS_CHANGED',
      name: 'Estado de usuario modificado — confirmación al admin',
      description: 'Push + email urgente al admin que activó o desactivó un usuario interno.',
      titleTemplate: 'Usuario {{accion}}: {{nombreUsuario}}',
      bodyTemplate: 'Has {{accion}} la cuenta del usuario {{nombreUsuario}} exitosamente.',
      emailSubjectTemplate: 'Confirmación: estado de usuario interno modificado',
      emailBodyTemplate: ADMIN_STATUS_CHANGED_EMAIL
    },
    {
      code: 'IAM_RBAC_PERMISSION_GRANTED',
      name: 'Permiso RBAC otorgado — confirmación al admin',
      description: 'Push + email urgente al admin que otorgó un permiso adicional en la matriz RBAC.',
      titleTemplate: 'Permiso otorgado: {{roleName}} → {{moduleName}}:{{action}}',
      bodyTemplate:
        'Has otorgado el permiso {{action}} sobre {{moduleName}} al rol {{roleName}}. El cambio está activo de inmediato.',
      emailSubjectTemplate: 'Confirmación: permiso RBAC otorgado',
      emailBodyTemplate: RBAC_GRANTED_EMAIL
    },
    {
      code: 'IAM_RBAC_PERMISSION_REVOKED',
      name: 'Permiso RBAC revocado — confirmación al admin',
      description: 'Push + email urgente al admin que revocó un permiso de la matriz RBAC.',
      titleTemplate: 'Permiso revocado: {{roleName}} → {{moduleName}}:{{action}}',
      bodyTemplate:
        'Has revocado el permiso {{action}} sobre {{moduleName}} del rol {{roleName}}. El cambio está activo de inmediato.',
      emailSubjectTemplate: 'Confirmación: permiso RBAC revocado',
      emailBodyTemplate: RBAC_REVOKED_EMAIL
    }
  ];
}
