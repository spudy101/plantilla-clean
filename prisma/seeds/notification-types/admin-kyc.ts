// prisma/seeds/notification-types/admin-kyc.ts
//
// Tipos de notificación generados por acciones del módulo admin/kyc.
//
// Criterios de canal:
//   Cliente → push + email cuando la acción altera acceso, datos sensibles o requiere acción.
//   Interno → push al admin que ejecutó (confirmación de operación).
//   Global  → push + email cuando aplica a todos los usuarios.
//
// Datos del seed (prisma/seeds/notification-types.seed.ts): solo se insertan los códigos que faltan.

import type { NotificationTypeSeed } from './types';

// ── Email templates ───────────────────────────────────────────────────────────

const _base = (logoSrc: string, title: string, bodyHtml: string) => `<!DOCTYPE html>
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

const USUARIO_CREADO_EMAIL = _base(
  '{{logoUrl}}',
  'Bienvenido a Base Project',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">¡Bienvenido, {{nombre}}!</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">Un administrador ha creado una cuenta para ti en Base Project. Tus credenciales de acceso son:</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;border-radius:6px;margin:0 0 24px">
    <tr><td style="padding:16px 20px">
      <p style="margin:0 0 8px;font-size:14px;color:#374151"><strong>Email:</strong> {{email}}</p>
      <p style="margin:0;font-size:14px;color:#374151"><strong>Contraseña temporal:</strong> <span style="font-family:monospace;background:#fff;padding:2px 6px;border-radius:4px;border:1px solid #d1d5db">{{passwordTemporal}}</span></p>
    </td></tr>
  </table>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">Por seguridad, te recomendamos cambiar tu contraseña en tu primer inicio de sesión.</p>`
);

const ACCOUNT_ACTIVATED_EMAIL = _base(
  '{{logoUrl}}',
  'Cuenta activada',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">Hola {{nombre}},</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">Tu cuenta en Base Project ha sido <strong>activada</strong>. Ya puedes iniciar sesión y acceder a todos los servicios.</p>`
);

const ACCOUNT_DEACTIVATED_EMAIL = _base(
  '{{logoUrl}}',
  'Cuenta desactivada',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">Hola {{nombre}},</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">Tu cuenta en Base Project ha sido <strong>desactivada temporalmente</strong>. Si tienes preguntas sobre esta acción, comunícate con soporte.</p>`
);

const PASSWORD_RESET_ADMIN_EMAIL = _base(
  '{{logoUrl}}',
  'Contraseña restablecida por administrador',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">Hola {{nombre}},</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">Un administrador ha restablecido tu contraseña en Base Project. Tu nueva contraseña temporal es:</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;border-radius:6px;margin:0 0 24px">
    <tr><td style="padding:16px 20px;text-align:center">
      <p style="margin:0;font-size:20px;font-family:monospace;color:#1a56db;letter-spacing:2px">{{passwordTemporal}}</p>
    </td></tr>
  </table>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0">Por seguridad, cámbiala en tu próximo inicio de sesión. Si no solicitaste este cambio, contacta a soporte de inmediato.</p>`
);

const EMAIL_CHANGED_OLD_EMAIL = _base(
  '{{logoUrl}}',
  'Tu correo electrónico fue actualizado',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">Hola {{nombre}},</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">Te informamos que el correo electrónico de tu cuenta Base Project fue <strong>actualizado</strong>. Este aviso fue enviado a la dirección anterior: <strong>{{email}}</strong>.</p>
  <p style="color:#dc2626;font-size:15px;font-weight:600;margin:0">Si no reconoces esta acción, contacta a soporte de inmediato.</p>`
);

const NATIONAL_ID_CHANGED_EMAIL = _base(
  '{{logoUrl}}',
  'Tu documento de identidad fue actualizado',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">Hola {{nombre}},</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">Tu número de documento de identidad en Base Project fue <strong>actualizado</strong> por un administrador.</p>
  <p style="color:#dc2626;font-size:15px;font-weight:600;margin:0">Si no reconoces esta acción, contacta a soporte de inmediato.</p>`
);

const ROL_CHANGE_EMAIL = _base(
  '{{logoUrl}}',
  'Tu rol fue actualizado',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">Hola {{nombre}},</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">Tu rol en Base Project fue actualizado a <strong>{{nuevo_rol}}</strong>.</p>
  <p style="color:#374151;font-size:14px;line-height:1.6;margin:0">{{permisos_descripcion}}</p>`
);

const PRIVACY_POLICY_EMAIL = _base(
  '{{logoUrl}}',
  'Actualización de política de privacidad',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">Política de privacidad actualizada</h2>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px">Hemos publicado una nueva versión de nuestra Política de Privacidad (<strong>v{{nuevaVersion}}</strong>), vigente desde el <strong>{{fechaVigencia}}</strong>.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;border-radius:6px;margin:0 0 24px">
    <tr><td style="padding:16px 20px">
      <p style="margin:0 0 4px;font-size:13px;color:#6b7280">Resumen de cambios</p>
      <p style="margin:0;font-size:14px;color:#374151">{{resumenCambios}}</p>
    </td></tr>
  </table>
  <div style="text-align:center;margin:0 0 16px">
    <a href="{{documentUrl}}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:15px">Leer política completa</a>
  </div>`
);

const NOTIFICACION_GENERAL_EMAIL = _base(
  '{{logoUrl}}',
  '{{asunto}}',
  `
  <h2 style="color:#1a56db;margin:0 0 16px">{{titulo}}</h2>
  <div style="color:#374151;font-size:15px;line-height:1.6">{{contenido}}</div>`
);

export function adminKycTypes(): NotificationTypeSeed[] {
  return [
    // ── CONSENT TYPE ────────────────────────────────────────────────────────

    {
      code: 'CONSENT_TYPE_ADMIN_ACTION',
      name: 'Acción sobre tipo de consentimiento',
      description: 'Push al admin que creó o actualizó un tipo de consentimiento.',
      titleTemplate: 'Tipo de consentimiento {{accion}}',
      bodyTemplate: "Has {{accion}} el tipo de consentimiento '{{code}}'.",
      emailSubjectTemplate: null,
      emailBodyTemplate: null
    },

    // ── ADMIN PERSON — cliente ──────────────────────────────────────────────

    {
      code: 'USUARIO_CREADO_ADMIN',
      name: 'Usuario creado por administrador',
      description: 'Email al nuevo usuario con sus credenciales cuando un admin crea su cuenta.',
      titleTemplate: '¡Bienvenido a Base Project!',
      bodyTemplate: 'Hola {{nombre}}, un administrador ha creado tu cuenta. Tu contraseña temporal es: {{passwordTemporal}}.',
      emailSubjectTemplate: 'Tu cuenta en Base Project ha sido creada',
      emailBodyTemplate: USUARIO_CREADO_EMAIL
    },
    {
      code: 'ACCOUNT_ACTIVATED',
      name: 'Cuenta activada',
      description: 'Push + email al cliente cuando el admin activa su cuenta.',
      titleTemplate: 'Tu cuenta fue activada',
      bodyTemplate: 'Tu cuenta en Base Project ha sido activada. Ya puedes iniciar sesión.',
      emailSubjectTemplate: 'Tu cuenta de Base Project fue activada',
      emailBodyTemplate: ACCOUNT_ACTIVATED_EMAIL
    },
    {
      code: 'ACCOUNT_DEACTIVATED',
      name: 'Cuenta desactivada',
      description: 'Push + email al cliente cuando el admin desactiva su cuenta.',
      titleTemplate: 'Tu cuenta fue desactivada',
      bodyTemplate: 'Tu cuenta en Base Project ha sido desactivada temporalmente. Contacta a soporte para más información.',
      emailSubjectTemplate: 'Tu cuenta de Base Project fue desactivada',
      emailBodyTemplate: ACCOUNT_DEACTIVATED_EMAIL
    },
    {
      code: 'PASSWORD_RESET_ADMIN',
      name: 'Contraseña restablecida por admin',
      description: 'Email al cliente con la nueva contraseña temporal cuando el admin la restablece.',
      titleTemplate: 'Tu contraseña fue restablecida',
      bodyTemplate: 'Un administrador restableci tu contraseña. Tu contraseña temporal es: {{passwordTemporal}}.',
      emailSubjectTemplate: 'Tu contraseña de Base Project fue restablecida',
      emailBodyTemplate: PASSWORD_RESET_ADMIN_EMAIL
    },
    {
      code: 'EMAIL_CHANGED_OLD',
      name: 'Cambio de email — aviso al correo anterior',
      description: 'Email al correo antiguo cuando el admin actualiza el email del cliente (crearNotificacionDirecta).',
      titleTemplate: 'Tu correo fue actualizado',
      bodyTemplate: 'Tu correo electrónico en Base Project fue actualizado.',
      emailSubjectTemplate: 'Aviso de seguridad: tu correo en Base Project fue actualizado',
      emailBodyTemplate: EMAIL_CHANGED_OLD_EMAIL
    },
    {
      code: 'EMAIL_CHANGED_NEW',
      name: 'Cambio de email — confirmación al nuevo correo',
      description: 'Push al cliente cuando el admin actualiza su email (confirmación en el nuevo correo).',
      titleTemplate: 'Tu correo fue actualizado',
      bodyTemplate: 'Tu correo electrónico en Base Project fue actualizado a {{email}} exitosamente.',
      emailSubjectTemplate: null,
      emailBodyTemplate: null
    },
    {
      code: 'NATIONAL_ID_CHANGED',
      name: 'Documento de identidad actualizado por admin',
      description: 'Push + email al cliente cuando el admin actualiza su número de documento.',
      titleTemplate: 'Tu documento de identidad fue actualizado',
      bodyTemplate: 'Tu número de documento de identidad en Base Project fue actualizado por un administrador.',
      emailSubjectTemplate: 'Aviso: tu documento de identidad en Base Project fue actualizado',
      emailBodyTemplate: NATIONAL_ID_CHANGED_EMAIL
    },
    {
      code: 'ROL_CHANGE',
      name: 'Rol actualizado',
      description: 'Push + email al cliente cuando el admin cambia su rol en la plataforma.',
      titleTemplate: 'Tu rol fue actualizado a {{nuevo_rol}}',
      bodyTemplate: 'Tu rol en Base Project fue actualizado a {{nuevo_rol}}.',
      emailSubjectTemplate: 'Tu rol en Base Project fue actualizado',
      emailBodyTemplate: ROL_CHANGE_EMAIL
    },

    // ── ADMIN PERSON — interno ──────────────────────────────────────────────

    {
      code: 'PERSON_ADMIN_ACTION',
      name: 'Acción administrativa sobre persona',
      description: 'Push interno al administrador que ejecutó una acción sobre un usuario.',
      titleTemplate: 'Acción completada',
      bodyTemplate: 'Has ejecutado la acción "{{accion}}" sobre el usuario {{userId}} exitosamente.',
      emailSubjectTemplate: null,
      emailBodyTemplate: null
    },

    // ── PRIVACY POLICY — global ─────────────────────────────────────────────

    {
      code: 'PRIVACY_POLICY_UPDATE',
      name: 'Actualización de política de privacidad',
      description:
        'Notificación global (userId=null) cuando se publica una nueva versión de la política de privacidad (RF-ADM-04).',
      titleTemplate: 'Actualizamos nuestra Política de Privacidad (v{{nuevaVersion}})',
      bodyTemplate:
        'Hemos actualizado nuestra Política de Privacidad. Vigente desde {{fechaVigencia}}. Revisa los cambios en la app.',
      emailSubjectTemplate: 'Actualización de Política de Privacidad — v{{nuevaVersion}}',
      emailBodyTemplate: PRIVACY_POLICY_EMAIL
    },

    // ── NOTIFICACION GENERAL — global ───────────────────────────────────────

    {
      code: 'NOTIFICACION_GENERAL',
      name: 'Notificación general',
      description:
        'Notificación global (userId=null) de contenido libre enviada por el admin. Soporta push + email con templates dinámicos.',
      titleTemplate: '{{titulo}}',
      bodyTemplate: '{{contenido}}',
      emailSubjectTemplate: '{{asunto}}',
      emailBodyTemplate: NOTIFICACION_GENERAL_EMAIL
    }
  ];
}
