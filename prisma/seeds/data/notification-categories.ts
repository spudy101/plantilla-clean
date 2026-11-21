// prisma/seeds/data/notification-categories.ts
//
// Categorías (grupos) de notificación del template. La categoría es la fuente de verdad de canales
// (email/sms/push), de la criticidad (crítica = llega siempre, sin mirar preferencias) y del layout base del email.
//
// El emailLayoutTemplate es el "cascarón" HTML+CSS compartido: contiene {{content}}, donde el
// email-notification.service inyecta el emailBodyTemplate (fragmento) de cada tipo. Así todos los
// emails de una categoría heredan el mismo diseño y editar cada notificación es solo cambiar texto.

export interface NotificationCategorySeed {
  code: string;
  name: string;
  description: string;
  supportsPush: boolean;
  supportsEmail: boolean;
  supportsSms: boolean;
  isCritical: boolean;
  /** Color de la barra superior del layout */
  accent: string;
}

// Layout base compartido. accent = color de la barra superior por categoría.
export const buildLayout = (accent: string) => `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#222;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="height:6px;background:${accent};"></td></tr>
        <tr><td style="padding:24px 32px 8px 32px;" align="left">
          <img src="{{logoUrl}}" alt="Base Project" style="max-height:40px;">
        </td></tr>
        <tr><td style="padding:8px 32px 24px 32px;font-size:15px;line-height:1.6;color:#333;">
          {{content}}
        </td></tr>
        <tr><td style="padding:16px 32px;background:#fafafa;border-top:1px solid #eee;font-size:12px;color:#999;" align="center">
          Este es un mensaje automático de Base Project. Podés gestionar tus preferencias de notificación desde la app.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

export const NOTIFICATION_CATEGORIES: NotificationCategorySeed[] = [
  {
    code: 'SECURITY',
    name: 'Seguridad',
    description: 'Eventos de seguridad de la cuenta: inicio de sesión, MFA, cambios de credenciales.',
    supportsPush: true,
    supportsEmail: true,
    supportsSms: true,
    isCritical: true,
    accent: '#c0392b'
  },
  {
    code: 'EMERGENCY',
    name: 'Emergencia',
    description: 'Alertas operativas urgentes que no pueden silenciarse.',
    supportsPush: true,
    supportsEmail: true,
    supportsSms: true,
    isCritical: true,
    accent: '#e74c3c'
  },
  {
    code: 'TRANSACTIONAL',
    name: 'Transaccional',
    description: 'Aprobaciones, verificación biométrica, KYC y documentos.',
    supportsPush: true,
    supportsEmail: true,
    supportsSms: false,
    isCritical: false,
    accent: '#2d6cdf'
  },
  {
    code: 'ACCOUNT',
    name: 'Cuenta',
    description: 'Registro, verificación de cuenta y cambios de perfil.',
    supportsPush: true,
    supportsEmail: true,
    supportsSms: false,
    isCritical: false,
    accent: '#16a085'
  },
  {
    code: 'COMMERCIAL',
    name: 'Comercial',
    description: 'Promociones y avisos comerciales.',
    supportsPush: true,
    supportsEmail: true,
    supportsSms: false,
    isCritical: false,
    accent: '#8e44ad'
  },
  {
    code: 'SYSTEM_ADMIN',
    name: 'Sistema (admin)',
    description: 'Avisos operativos internos dirigidos a administradores.',
    supportsPush: false,
    supportsEmail: true,
    supportsSms: false,
    isCritical: false,
    accent: '#34495e'
  }
];
