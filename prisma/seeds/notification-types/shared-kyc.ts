// prisma/seeds/notification-types/shared-kyc.ts
//
// Notificaciones para shared-endpoints/kyc/
// Services: auth-login, mfa, profile, contact-inquiry (BIENVENIDA → client-kyc seeder)
// (maintainers no genera notificaciones — solo catálogos)
//
// CANALES:
//   - Interno   → siempre (se inserta en tabla notifications). Es la base.
//   - Email SES → eventos de seguridad o cambios críticos que el usuario debe saber.
//   - Push SNS  → alertas inmediatas que necesitan atención en el momento.
//
// DECISIONES DE CANAL POR TIPO:
//   NUEVO_DISPOSITIVO       → email + push (alerta de seguridad, acción inmediata posible)
//   ACCOUNT_BLOCKED         → email + push (el usuario no puede entrar, necesita saberlo ya)
//   LOGOUT_ALL              → email (alguien cerró todas las sesiones, puede no ser él)
//   TOTP_ACTIVADO/ELIMINADO → solo interno (el usuario lo hizo él, ya lo sabe)
//   SMS_MFA_ACTIVADO/ELIM.  → solo interno (ídem)
//   PASSWORD_UPDATED        → email (cambio de seguridad crítico, auditable por email)
//   EMAIL_UPDATED           → email (confirmación al correo anterior)
//   PHONE_UPDATED           → solo interno (el usuario lo hizo él)
//   PROFILE_UPDATED         → solo interno (cambios cosméticos, el usuario lo hizo él)
//   NATIONAL_ID_UPDATED     → email (dato sensible, confirmación necesaria)
//   CUENTA_ELIMINADA        → email (confirmación final, crearNotificacionDirecta)
//   CONTACT_INQUIRY_ACUSE   → email (acuse al remitente, puede no tener cuenta)
//   CONTACT_INQUIRY_ADMIN   → email (alerta al equipo interno)
//
// Datos del seed (prisma/seeds/notification-types.seed.ts): solo se insertan los códigos que faltan.

import type { NotificationTypeSeed } from './types';

export function sharedKycTypes(logo: string): NotificationTypeSeed[] {
  return [
    // ══════════════════════════════════════════════════════════════════════
    // AUTH-LOGIN — acceso y seguridad (BIENVENIDA está en client-kyc seeder)
    // ══════════════════════════════════════════════════════════════════════

    // [RF-AUTH-03] | CA-03 | Tipo de notificación para nuevo dispositivo detectado;
    // supports_push: true + supports_email: true. Metadata: nombre, ip, browser, os,
    // ciudad, país, deviceName, fechaAcceso
    {
      code: 'NUEVO_DISPOSITIVO_DETECTADO',
      name: 'Nuevo Dispositivo Detectado',
      description: 'Alerta de seguridad cuando el usuario accede desde un dispositivo no reconocido',
      titleTemplate: 'Nuevo acceso desde un dispositivo no reconocido',
      bodyTemplate:
        'Detectamos un acceso desde {{browser}} en {{os}}, {{ciudad}}. Si no fuiste tú, bloquéalo desde Configuración → Dispositivos.',
      emailSubjectTemplate: 'Alerta de seguridad: nuevo acceso a tu cuenta',
      emailBodyTemplate: `
          <html>
            <body style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
              <div style="text-align: center;">
                <img src="${logo}" alt="Logo" style="width: 150px; margin-bottom: 20px;">
                <h2 style="color: #e67e22;">⚠️ Nuevo acceso desde un dispositivo no reconocido</h2>
              </div>
              <div style="font-size: 16px; color: #333; line-height: 1.6; margin: 20px 0;">
                <p>Hola <strong>{{nombre}}</strong>,</p>
                <p>Detectamos un inicio de sesión desde un <strong>dispositivo no reconocido</strong>. El acceso fue <strong>permitido</strong>, pero te avisamos para que puedas revisarlo.</p>
                <div style="background-color: #f8f9fa; border-left: 4px solid #e67e22; padding: 15px; margin: 20px 0; border-radius: 4px;">
                  <p style="margin: 4px 0;"><strong>Fecha:</strong> {{fechaAcceso}}</p>
                  <p style="margin: 4px 0;"><strong>IP:</strong> {{ip}}</p>
                  <p style="margin: 4px 0;"><strong>Navegador:</strong> {{browser}}</p>
                  <p style="margin: 4px 0;"><strong>Sistema operativo:</strong> {{os}}</p>
                  <p style="margin: 4px 0;"><strong>Ubicación:</strong> {{ciudad}}, {{pais}}</p>
                  <p style="margin: 4px 0;"><strong>Dispositivo:</strong> {{deviceName}}</p>
                </div>
                <p>Si <strong>fuiste tú</strong>, no necesitas hacer nada.</p>
                <p>Si <strong>no reconoces esta actividad</strong>, bloquea el dispositivo desde <strong>Configuración → Dispositivos</strong> y cambia tu contraseña.</p>
              </div>
              <div style="font-size: 12px; color: #555; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center;">
                <p>Este es un correo automático, por favor no respondas a este mensaje.</p>
              </div>
            </body>
          </html>
        `,
      isActive: true
    },

    {
      // NUEVO — no existía en seeders anteriores
      code: 'ACCOUNT_BLOCKED',
      name: 'Cuenta Bloqueada',
      description: 'Alerta cuando la cuenta queda bloqueada por múltiples intentos fallidos de login',
      titleTemplate: 'Tu cuenta ha sido bloqueada temporalmente',
      bodyTemplate:
        'Tu cuenta fue bloqueada por {{intentosFallidos}} intentos fallidos. Estará disponible en {{minutosBloqueo}} minutos.',
      emailSubjectTemplate: 'Aviso de seguridad: cuenta bloqueada temporalmente',
      emailBodyTemplate: `
          <html>
            <body style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
              <div style="text-align: center;">
                <img src="${logo}" alt="Logo" style="width: 150px; margin-bottom: 20px;">
                <h2 style="color: #dc3545;">🔒 Cuenta bloqueada temporalmente</h2>
              </div>
              <div style="font-size: 16px; color: #333; line-height: 1.6; margin: 20px 0;">
                <p>Hola <strong>{{nombre}}</strong>,</p>
                <p>Tu cuenta fue <strong>bloqueada temporalmente</strong> por múltiples intentos de inicio de sesión fallidos.</p>
                <div style="background-color: #fff3cd; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0; border-radius: 4px;">
                  <p style="margin: 4px 0;"><strong>Motivo:</strong> {{intentosFallidos}} intentos fallidos consecutivos</p>
                  <p style="margin: 4px 0;"><strong>Duración del bloqueo:</strong> {{minutosBloqueo}} minutos</p>
                </div>
                <p>Si <strong>fuiste tú</strong>, espera {{minutosBloqueo}} minutos e intenta de nuevo.</p>
                <p>Si <strong>no reconoces esta actividad</strong>, contacta a soporte de inmediato.</p>
              </div>
              <div style="font-size: 12px; color: #555; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center;">
                <p>Este es un correo automático, por favor no respondas a este mensaje.</p>
              </div>
            </body>
          </html>
        `,
      isActive: true
    },

    {
      // NUEVO — no existía en seeders anteriores
      code: 'LOGOUT_ALL',
      name: 'Cierre de Todas las Sesiones',
      description: 'Notificación cuando el usuario cierra todas sus sesiones activas',
      titleTemplate: 'Todas tus sesiones fueron cerradas',
      bodyTemplate: 'Todas las sesiones activas de tu cuenta fueron cerradas.',
      emailSubjectTemplate: 'Aviso de seguridad: todas tus sesiones fueron cerradas',
      emailBodyTemplate: `
          <html>
            <body style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
              <div style="text-align: center;">
                <img src="${logo}" alt="Logo" style="width: 150px; margin-bottom: 20px;">
                <h2 style="color: #343a40;">🔐 Cierre masivo de sesiones</h2>
              </div>
              <div style="font-size: 16px; color: #333; line-height: 1.6; margin: 20px 0;">
                <p>Hola <strong>{{nombre}}</strong>,</p>
                <p>Te informamos que <strong>todas las sesiones activas</strong> de tu cuenta fueron cerradas.</p>
                <p>Si <strong>fuiste tú</strong>, no necesitas hacer nada.</p>
                <p>Si <strong>no reconoces esta acción</strong>, cambia tu contraseña inmediatamente y contacta a soporte.</p>
              </div>
              <div style="font-size: 12px; color: #555; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center;">
                <p>Este es un correo automático, por favor no respondas a este mensaje.</p>
              </div>
            </body>
          </html>
        `,
      isActive: true
    },

    // ══════════════════════════════════════════════════════════════════════
    // MFA — autenticación de doble factor
    // Solo interno: el usuario realizó la acción, ya la sabe.
    // ══════════════════════════════════════════════════════════════════════

    {
      code: 'TOTP_ACTIVADO',
      name: 'TOTP Activado',
      description: 'Registro interno cuando el usuario activa TOTP (autenticador)',
      titleTemplate: 'Autenticador TOTP activado',
      bodyTemplate: 'Has activado la autenticación de dos factores (TOTP) en tu cuenta.',
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
      isActive: true
    },

    {
      code: 'TOTP_ELIMINADO',
      name: 'TOTP Desactivado',
      description: 'Registro interno cuando el usuario desactiva su propio TOTP',
      titleTemplate: 'Autenticador TOTP desactivado',
      bodyTemplate: 'Has desactivado la autenticación de dos factores (TOTP) de tu cuenta.',
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
      isActive: true
    },

    {
      // NUEVO — bug fix: mfa.service usaba TOTP_ACTIVADO para SMS MFA
      code: 'SMS_MFA_ACTIVADO',
      name: 'SMS MFA Activado',
      description: 'Registro interno cuando el usuario activa SMS como método MFA',
      titleTemplate: 'SMS MFA activado',
      bodyTemplate: 'Has activado la autenticación por SMS en tu cuenta.',
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
      isActive: true
    },

    {
      // NUEVO — bug fix: mfa.service usaba TOTP_ELIMINADO para SMS MFA
      code: 'SMS_MFA_DESACTIVADO',
      name: 'SMS MFA Desactivado',
      description: 'Registro interno cuando el usuario desactiva SMS como método MFA',
      titleTemplate: 'SMS MFA desactivado',
      bodyTemplate: 'Has desactivado la autenticación por SMS de tu cuenta.',
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
      isActive: true
    },

    // ══════════════════════════════════════════════════════════════════════
    // PROFILE — actualizaciones de datos personales
    // ══════════════════════════════════════════════════════════════════════

    {
      code: 'PROFILE_UPDATED',
      name: 'Perfil Actualizado',
      description: 'Registro interno cuando el usuario actualiza datos de su perfil (username, avatar, género, ubicación)',
      titleTemplate: 'Perfil actualizado',
      bodyTemplate: 'Has actualizado tu perfil exitosamente.',
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
      isActive: true
    },

    {
      code: 'EMAIL_UPDATED',
      name: 'Email Actualizado',
      description: 'Confirmación al correo anterior cuando el usuario actualiza su email',
      titleTemplate: 'Tu correo electrónico fue actualizado',
      bodyTemplate: 'Has actualizado tu correo electrónico.',
      emailSubjectTemplate: 'Aviso: tu correo electrónico fue actualizado',
      emailBodyTemplate: `
          <html>
            <body style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
              <div style="text-align: center;">
                <img src="${logo}" alt="Logo" style="width: 150px; margin-bottom: 20px;">
                <h2 style="color: #343a40;">📧 Cambio de correo electrónico</h2>
              </div>
              <div style="font-size: 16px; color: #333; line-height: 1.6; margin: 20px 0;">
                <p>Hola <strong>{{nombre}}</strong>,</p>
                <p>Te confirmamos que el correo electrónico asociado a tu cuenta fue <strong>actualizado</strong>.</p>
                <p>Si <strong>no reconoces este cambio</strong>, contacta a soporte de inmediato.</p>
              </div>
              <div style="font-size: 12px; color: #555; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center;">
                <p>Este es un correo automático, por favor no respondas a este mensaje.</p>
              </div>
            </body>
          </html>
        `,
      isActive: true
    },

    {
      code: 'PHONE_UPDATED',
      name: 'Teléfono Actualizado',
      description: 'Registro interno cuando el usuario actualiza su número de teléfono',
      titleTemplate: 'Teléfono actualizado',
      bodyTemplate: 'Has actualizado tu número de teléfono exitosamente.',
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
      isActive: true
    },

    {
      code: 'PASSWORD_UPDATED',
      name: 'Contraseña Actualizada',
      description: 'Confirmación por email cuando el usuario cambia su propia contraseña desde perfil',
      titleTemplate: 'Tu contraseña fue actualizada',
      bodyTemplate: 'Has cambiado tu contraseña exitosamente.',
      emailSubjectTemplate: 'Aviso de seguridad: tu contraseña fue actualizada',
      emailBodyTemplate: `
          <html>
            <body style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
              <div style="text-align: center;">
                <img src="${logo}" alt="Logo" style="width: 150px; margin-bottom: 20px;">
                <h2 style="color: #343a40;">🔑 Contraseña actualizada</h2>
              </div>
              <div style="font-size: 16px; color: #333; line-height: 1.6; margin: 20px 0;">
                <p>Hola <strong>{{nombre}}</strong>,</p>
                <p>Tu <strong>contraseña fue actualizada correctamente</strong>.</p>
                <p>Si <strong>no reconoces este cambio</strong>, contacta a soporte de inmediato y cambia tu contraseña.</p>
              </div>
              <div style="font-size: 12px; color: #555; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center;">
                <p>Este es un correo automático, por favor no respondas a este mensaje.</p>
              </div>
            </body>
          </html>
        `,
      isActive: true
    },

    {
      code: 'NATIONAL_ID_UPDATED',
      name: 'ID Nacional Actualizado',
      description: 'Confirmación por email cuando el usuario actualiza su número de identificación',
      titleTemplate: 'Tu número de identificación fue actualizado',
      bodyTemplate: 'Has actualizado tu número de identificación nacional exitosamente.',
      emailSubjectTemplate: 'Aviso: tu número de identificación fue actualizado',
      emailBodyTemplate: `
          <html>
            <body style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
              <div style="text-align: center;">
                <img src="${logo}" alt="Logo" style="width: 150px; margin-bottom: 20px;">
                <h2 style="color: #343a40;">🪪 Identificación actualizada</h2>
              </div>
              <div style="font-size: 16px; color: #333; line-height: 1.6; margin: 20px 0;">
                <p>Hola <strong>{{nombre}}</strong>,</p>
                <p>Tu <strong>número de identificación nacional fue actualizado</strong> en tu cuenta.</p>
                <p>Si <strong>no reconoces este cambio</strong>, contacta a soporte de inmediato.</p>
              </div>
              <div style="font-size: 12px; color: #555; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center;">
                <p>Este es un correo automático, por favor no respondas a este mensaje.</p>
              </div>
            </body>
          </html>
        `,
      isActive: true
    },

    {
      code: 'CUENTA_ELIMINADA',
      name: 'Cuenta Eliminada',
      description: 'Confirmación por email cuando el usuario elimina su cuenta (crearNotificacionDirecta)',
      titleTemplate: 'Tu cuenta fue eliminada',
      bodyTemplate: 'Tu cuenta fue eliminada exitosamente.',
      emailSubjectTemplate: 'Tu cuenta de Base Project fue eliminada',
      emailBodyTemplate: `
          <html>
            <body style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
              <div style="text-align: center;">
                <img src="${logo}" alt="Logo" style="width: 150px; margin-bottom: 20px;">
                <h2 style="color: #dc3545;">Cuenta eliminada</h2>
              </div>
              <div style="font-size: 16px; color: #333; line-height: 1.6; margin: 20px 0;">
                <p>Hola <strong>{{nombre}}</strong>,</p>
                <p>Tu cuenta de <strong>Base Project fue eliminada exitosamente</strong>. Tus datos serán tratados según nuestra política de privacidad.</p>
                <p>Si tienes alguna duda, contáctanos en soporte.</p>
              </div>
              <div style="font-size: 12px; color: #555; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center;">
                <p>Este es un correo automático, por favor no respondas a este mensaje.</p>
              </div>
            </body>
          </html>
        `,
      isActive: true
    }

    // ══════════════════════════════════════════════════════════════════════
    // CONTACT-INQUIRY — PQRS
    // Usan crearNotificacionDirecta (el remitente puede no tener cuenta).
    // NUEVO — no existían en ningún seeder anterior.
    // ══════════════════════════════════════════════════════════════════════
  ];
}
