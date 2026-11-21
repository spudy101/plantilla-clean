// prisma/seeds/notification-types/client-kyc.ts
//
// Notificaciones para modules/client/kyc/
// Services: auth-register, auth-biometric, send-verification
//
// CANALES:
//   - Interno   → siempre (tabla notifications). Es la base.
//   - Email SES → seguridad crítica o cambios que el usuario debe auditar.
//   - Push SNS  → alertas inmediatas que requieren atención en el momento.
//
// DECISIONES DE CANAL POR TIPO:
//   SOLICITUD_RESET_PASSWORD/MFA      → email (seguridad, enlace de acción requerido)
//   RESET_PASSWORD/MFA                → email (confirmación de cambio crítico)
//   BIOMETRIC_CREDENTIAL_REGISTERED   → email + push (alerta de seguridad nueva credencial)
//   CODIGO_VERIFICACION               → email (OTP, crearNotificacionDirecta)
//   BIENVENIDA                        → email (onboarding)
//
// Datos del seed (prisma/seeds/notification-types.seed.ts): solo se insertan los códigos que faltan.

import type { NotificationTypeSeed } from './types';

export function clientKycTypes(): NotificationTypeSeed[] {
  return [
    // ══════════════════════════════════════════════════════════════════════
    // AUTH-REGISTER — bienvenida y reset de credenciales
    // ══════════════════════════════════════════════════════════════════════

    {
      code: 'BIENVENIDA',
      name: 'Bienvenida',
      description: 'Email de bienvenida cuando un usuario se registra exitosamente',
      titleTemplate: '¡Bienvenido a Base Project!',
      bodyTemplate: 'Hola {{nombre}}, te has registrado exitosamente. Completa tu perfil para comenzar a usar la plataforma.',
      emailSubjectTemplate: '¡Bienvenido a Base Project!',
      emailBodyTemplate: `<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; background-color: #f4f4f4;">
  <div style="background-color: #ffffff; border-radius: 8px; padding: 30px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="{{logoUrl}}" alt="Base Project" style="height: 48px;">
    </div>
    <h2 style="color: #1a1a2e; font-size: 20px; margin-bottom: 16px;">¡Bienvenido a Base Project!</h2>
    <p style="color: #444; line-height: 1.6;">Hola <strong>{{nombre}}</strong>,</p>
    <p style="color: #444; line-height: 1.6;">Tu registro fue exitoso. Ya puedes acceder a la plataforma y completar tu perfil.</p>
    <p style="color: #444; line-height: 1.6;">Saludos,<br><strong>El equipo de Base Project</strong></p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
    <p style="color: #999; font-size: 12px; text-align: center;">Este es un correo automático. Por favor no respondas a este mensaje.</p>
  </div>
</body>
</html>`
    },

    {
      code: 'SOLICITUD_RESET_PASSWORD',
      name: 'Solicitud de Restablecimiento de Contraseña',
      description: 'Email con enlace de reset cuando el usuario solicita recuperar su contraseña',
      titleTemplate: 'Solicitud de restablecimiento de contraseña',
      bodyTemplate:
        'Hola {{nombre}}, recibimos una solicitud para restablecer tu contraseña. Si no fuiste tú, ignora este mensaje.',
      emailSubjectTemplate: 'Restablece tu contraseña de Base Project',
      emailBodyTemplate: `<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; background-color: #f4f4f4;">
  <div style="background-color: #ffffff; border-radius: 8px; padding: 30px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="{{logoUrl}}" alt="Base Project" style="height: 48px;">
    </div>
    <h2 style="color: #1a1a2e; font-size: 20px; margin-bottom: 16px;">Restablecimiento de contraseña</h2>
    <p style="color: #444; line-height: 1.6;">Hola <strong>{{nombre}}</strong>,</p>
    <p style="color: #444; line-height: 1.6;">Recibimos una solicitud para restablecer la contraseña de tu cuenta en Base Project. Haz clic en el botón a continuación para continuar:</p>
    <div style="text-align: center; margin: 28px 0;">
      <a href="{{enlace}}" style="background-color: #007bff; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: bold;">Restablecer contraseña</a>
    </div>
    <p style="color: #666; font-size: 13px;">Este enlace vence en 30 minutos. Si no solicitaste este cambio, ignora este correo — tu contraseña no cambiará.</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
    <p style="color: #999; font-size: 12px; text-align: center;">Este es un correo automático. Por favor no respondas a este mensaje.</p>
  </div>
</body>
</html>`
    },

    {
      code: 'SOLICITUD_RESET_MFA',
      name: 'Solicitud de Restablecimiento de MFA',
      description: 'Email con enlace de reset cuando el usuario solicita recuperar su doble factor',
      titleTemplate: 'Solicitud de restablecimiento de doble factor',
      bodyTemplate:
        'Hola {{nombre}}, recibimos una solicitud para restablecer tu autenticador. Si no fuiste tú, ignora este mensaje.',
      emailSubjectTemplate: 'Restablece tu autenticador de Base Project',
      emailBodyTemplate: `<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; background-color: #f4f4f4;">
  <div style="background-color: #ffffff; border-radius: 8px; padding: 30px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="{{logoUrl}}" alt="Base Project" style="height: 48px;">
    </div>
    <h2 style="color: #1a1a2e; font-size: 20px; margin-bottom: 16px;">Restablecimiento de autenticador</h2>
    <p style="color: #444; line-height: 1.6;">Hola <strong>{{nombre}}</strong>,</p>
    <p style="color: #444; line-height: 1.6;">Recibimos una solicitud para restablecer el doble factor de autenticación de tu cuenta. Haz clic en el botón a continuación para continuar:</p>
    <div style="text-align: center; margin: 28px 0;">
      <a href="{{enlace}}" style="background-color: #007bff; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: bold;">Restablecer autenticador</a>
    </div>
    <p style="color: #666; font-size: 13px;">Este enlace vence en 30 minutos. Si no solicitaste este cambio, ignora este correo.</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
    <p style="color: #999; font-size: 12px; text-align: center;">Este es un correo automático. Por favor no respondas a este mensaje.</p>
  </div>
</body>
</html>`
    },

    {
      code: 'RESET_PASSWORD',
      name: 'Contraseña Restablecida',
      description: 'Confirmación por email de que la contraseña fue restablecida exitosamente',
      titleTemplate: 'Tu contraseña ha sido restablecida',
      bodyTemplate:
        'Hola {{nombre}}, tu contraseña fue restablecida exitosamente. Si no fuiste tú, contacta a soporte de inmediato.',
      emailSubjectTemplate: 'Tu contraseña de Base Project ha sido restablecida',
      emailBodyTemplate: `<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; background-color: #f4f4f4;">
  <div style="background-color: #ffffff; border-radius: 8px; padding: 30px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="{{logoUrl}}" alt="Base Project" style="height: 48px;">
    </div>
    <h2 style="color: #1a1a2e; font-size: 20px; margin-bottom: 16px;">Contraseña restablecida</h2>
    <p style="color: #444; line-height: 1.6;">Hola <strong>{{nombre}}</strong>,</p>
    <p style="color: #444; line-height: 1.6;">Tu contraseña ha sido restablecida exitosamente. Si realizaste este cambio, puedes ignorar este mensaje.</p>
    <p style="color: #c0392b; font-weight: bold;">Si no solicitaste este cambio, contacta a soporte de inmediato.</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
    <p style="color: #999; font-size: 12px; text-align: center;">Este es un correo automático. Por favor no respondas a este mensaje.</p>
  </div>
</body>
</html>`
    },

    {
      code: 'RESET_MFA',
      name: 'Autenticador Restablecido',
      description: 'Confirmación por email de que el doble factor fue restablecido exitosamente',
      titleTemplate: 'Tu autenticador ha sido restablecido',
      bodyTemplate:
        'Hola {{nombre}}, tu doble factor de autenticación fue restablecido exitosamente. Si no fuiste tú, contacta a soporte.',
      emailSubjectTemplate: 'Tu autenticador de Base Project ha sido restablecido',
      emailBodyTemplate: `<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; background-color: #f4f4f4;">
  <div style="background-color: #ffffff; border-radius: 8px; padding: 30px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="{{logoUrl}}" alt="Base Project" style="height: 48px;">
    </div>
    <h2 style="color: #1a1a2e; font-size: 20px; margin-bottom: 16px;">Autenticador restablecido</h2>
    <p style="color: #444; line-height: 1.6;">Hola <strong>{{nombre}}</strong>,</p>
    <p style="color: #444; line-height: 1.6;">Tu doble factor de autenticación ha sido restablecido exitosamente. Si realizaste este cambio, puedes ignorar este mensaje.</p>
    <p style="color: #c0392b; font-weight: bold;">Si no solicitaste este cambio, contacta a soporte de inmediato.</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
    <p style="color: #999; font-size: 12px; text-align: center;">Este es un correo automático. Por favor no respondas a este mensaje.</p>
  </div>
</body>
</html>`
    },

    // ══════════════════════════════════════════════════════════════════════
    // AUTH-BIOMETRIC — credencial biométrica
    // ══════════════════════════════════════════════════════════════════════

    {
      code: 'BIOMETRIC_CREDENTIAL_REGISTERED',
      name: 'Credencial Biométrica Registrada',
      description: 'Alerta de seguridad cuando se registra una nueva credencial biométrica en la cuenta',
      titleTemplate: 'Nueva huella biométrica registrada',
      bodyTemplate:
        'Hola {{nombre}}, una nueva credencial biométrica fue registrada en tu cuenta. Si no fuiste tú, contacta a soporte.',
      emailSubjectTemplate: 'Alerta de seguridad: nueva credencial biométrica registrada',
      emailBodyTemplate: `<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; background-color: #f4f4f4;">
  <div style="background-color: #ffffff; border-radius: 8px; padding: 30px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="{{logoUrl}}" alt="Base Project" style="height: 48px;">
    </div>
    <h2 style="color: #1a1a2e; font-size: 20px; margin-bottom: 16px;">Nueva credencial biométrica registrada</h2>
    <p style="color: #444; line-height: 1.6;">Hola <strong>{{nombre}}</strong>,</p>
    <p style="color: #444; line-height: 1.6;">Se ha registrado una nueva credencial biométrica (huella o Face ID) en tu cuenta de Base Project. Si realizaste este registro, no es necesaria ninguna acción.</p>
    <p style="color: #c0392b; font-weight: bold;">Si no reconoces esta actividad, elimina la credencial desde la app e informa a soporte de inmediato.</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
    <p style="color: #999; font-size: 12px; text-align: center;">Este es un correo automático. Por favor no respondas a este mensaje.</p>
  </div>
</body>
</html>`
    },

    // ══════════════════════════════════════════════════════════════════════
    // SEND VERIFICATION — código OTP
    // ══════════════════════════════════════════════════════════════════════

    {
      code: 'CODIGO_VERIFICACION',
      name: 'Código de Verificación',
      description: 'OTP enviado por email para verificar el contacto del usuario (crearNotificacionDirecta)',
      titleTemplate: 'Tu código de verificación',
      bodyTemplate: 'Tu código de verificación es {{codigo}}. Válido por {{minutos}} minutos.',
      emailSubjectTemplate: 'Tu código de verificación de Base Project',
      emailBodyTemplate: `<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; background-color: #f4f4f4;">
  <div style="background-color: #ffffff; border-radius: 8px; padding: 30px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="{{logoUrl}}" alt="Base Project" style="height: 48px;">
    </div>
    <h2 style="color: #1a1a2e; font-size: 20px; margin-bottom: 16px;">Código de verificación</h2>
    <p style="color: #444; line-height: 1.6;">Tu código de verificación es:</p>
    <div style="text-align: center; margin: 24px 0;">
      <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #007bff;">{{codigo}}</span>
    </div>
    <p style="color: #666; font-size: 13px; text-align: center;">Este código vence en {{minutos}} minutos. No lo compartas con nadie.</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
    <p style="color: #999; font-size: 12px; text-align: center;">Este es un correo automático. Por favor no respondas a este mensaje.</p>
  </div>
</body>
</html>`
    }
  ];
}
