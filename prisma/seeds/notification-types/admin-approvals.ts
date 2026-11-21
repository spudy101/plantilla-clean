// prisma/seeds/notification-types/admin-approvals.ts
//
// Tipos de notificación del framework de doble aprobación global (maker-checker).
//
//   RBAC_SECOND_APPROVER  → aviso al ADMIN de una operación sensible pendiente (cambio de rol,
//                           borrado de cuenta/usuario, corrección de identidad)
//   DUAL_APPROVAL_RESOLVED → aviso al maker cuando su solicitud se aprueba/rechaza
//
// Datos del seed (prisma/seeds/notification-types.seed.ts): solo se insertan los códigos que faltan.

import type { NotificationTypeSeed } from './types';

const EMAIL_APPROVER = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; color: #222;">
  <img src="{{logoUrl}}" alt="Base Project" style="max-height:48px;" />
  <h2>Segunda aprobación requerida</h2>
  <p>Hola {{firstName}},</p>
  <p>Una operación quedó <strong>pendiente de tu aprobación</strong>:</p>
  <p style="font-size:16px;"><strong>{{operationLabel}}</strong></p>
  <p>Revísala y resuélvela (aprobar o rechazar) desde el panel de doble aprobación.</p>
  <p style="color:#888;font-size:12px;">Solicitud: {{approvalRequestId}}</p>
</body>
</html>`;

const EMAIL_RESOLVED = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; color: #222;">
  <img src="{{logoUrl}}" alt="Base Project" style="max-height:48px;" />
  <h2>Tu solicitud fue resuelta</h2>
  <p>La operación <strong>{{operationLabel}}</strong> que enviaste fue <strong>{{decision}}</strong> por el segundo aprobador.</p>
  <p style="color:#888;font-size:12px;">Solicitud: {{approvalRequestId}}</p>
</body>
</html>`;

const approverType = (code: string, name: string): NotificationTypeSeed => ({
  code,
  name,
  description: 'Aviso al aprobador de una operación pendiente de segunda aprobación (doble aprobación global).',
  titleTemplate: 'Segunda aprobación requerida',
  bodyTemplate: '{{operationLabel}} requiere tu aprobación.',
  emailSubjectTemplate: '[Acción requerida] Segunda aprobación — Base Project',
  emailBodyTemplate: EMAIL_APPROVER
});

export function adminApprovalTypes(): NotificationTypeSeed[] {
  return [
    approverType('RBAC_SECOND_APPROVER', 'Segunda Aprobación Requerida'),
    {
      code: 'DUAL_APPROVAL_RESOLVED',
      name: 'Solicitud de Doble Aprobación Resuelta',
      description: 'Aviso al maker cuando su solicitud de doble aprobación es aprobada o rechazada.',
      titleTemplate: 'Tu solicitud fue {{decision}}',
      bodyTemplate: 'La operación "{{operationLabel}}" fue {{decision}} por el segundo aprobador.',
      emailSubjectTemplate: 'Tu solicitud de aprobación fue resuelta — Base Project',
      emailBodyTemplate: EMAIL_RESOLVED
    }
  ];
}
