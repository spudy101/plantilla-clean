import type { Prisma } from '../../../../shared/database/generated/prisma/client';
import iamModule from '../../../iam';
const { userRepository } = iamModule;
import type { UserAdminTargetRow } from '../../../iam';
// modules/admin/kyc/person/services/admin-person/person-credentials.service.ts
//
// Credenciales e identidad de una cuenta: reset de contraseña, cambio de email,
// cambio de documento y desactivación de MFA. Extraído de PersonService (SOLID: S).

import type { AdminAuditContext } from '../../../../shared/types/audit-context';
import unitOfWork from '../../../../shared/database/unit-of-work';
import KycSharedUtil from '../../utils/kyc-shared.util';
import notificationModule from '../../../notification';
const { notifier } = notificationModule;
import AppError from '../../../../shared/http/app-error.util';
import loggerUtilModule from '../../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import ProfileHelper from '../../helpers/profile.helper';
import constantsModule from '../../../../shared/constants';
const { notifications } = constantsModule;

import adminPersonDtoModule from '../../responses/admin-person.response';
const { ResetPasswordDTO, ChangeEmailDTO, ChangeNationalIdDTO, DisableMFADTO } = adminPersonDtoModule;
import personGuardsModule from './person-guards';
const { assertNotDeleted, requirePerson } = personGuardsModule;
import auditModule from '../../../audit';
const { audit } = auditModule;

class PersonCredentialsService {
  unitOfWork: typeof unitOfWork;
  profileHelper: typeof ProfileHelper;
  userRepository: typeof userRepository;
  notifier: typeof notifier;

  /**
   * @param {object} [deps] Dependencias inyectables (SOLID: D). Las provee la fachada
   *   PersonService; por defecto se usan las implementaciones reales.
   */
  constructor(deps: PersonCredentialsService.Deps = {}) {
    this.unitOfWork = deps.unitOfWork ?? unitOfWork;
    this.profileHelper = deps.profileHelper ?? ProfileHelper;
    this.userRepository = deps.userRepository ?? userRepository;
    this.notifier = deps.notifier ?? notifier;
  }

  // ============================================================
  // RESET PASSWORD
  // ============================================================

  async resetPassword(userId: string, auditContext: AdminAuditContext) {
    const { user, temporaryPassword } = await this.unitOfWork.run(async () => {
      const user = await this.userRepository.findAdminTarget(userId);

      if (!user) {
        throw AppError.notFound('Usuario no encontrado');
      }
      assertNotDeleted(user);

      const temporaryPassword = KycSharedUtil.generateSecurePassword();

      await this.userRepository.updatePassword(userId, temporaryPassword);

      await KycSharedUtil.logChange({
        userId: user.userId,
        changedByUserId: auditContext.adminUserId,
        changedByRole: 'admin',
        changeType: 'password',
        previousValue: 'hidden',
        newValue: 'hidden',
        changeReason: 'Contraseña reseteada por administrador',
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent
      });
      return { user, temporaryPassword };
    });

    await audit.record('PERSON_PASSWORD_RESET', {
      actorId: auditContext.adminUserId,
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    const affectedNombre = user.person?.firstName || 'Usuario';
    const affectedEmail = user.person?.contact?.email;

    setImmediate(() => {
      this.notifier.notify({
        type: 'PASSWORD_RESET_ADMIN',
        userId: user.userId,
        relatedEntity: null,
        metadata: {
          nombre: affectedNombre,
          email: affectedEmail,
          passwordTemporal: temporaryPassword,
          logoUrl: notifications.ses.logoUrl
        }
      }).catch(err => logger.warn('Error sending password reset notification', { error: err.message }));

      this.notifier.notify({
        type: 'PERSON_ADMIN_ACTION',
        userId: auditContext.adminUserId,
        relatedEntity: null,
        metadata: {
          nombre: auditContext.adminFirstName,
          accion: 'reset_password',
          userId: userId,
          logoUrl: notifications.ses.logoUrl
        }
      }).catch(err => logger.warn('Error sending admin action notification', { error: err.message }));
    });

    return ResetPasswordDTO(user);
  }

  // ============================================================
  // CAMBIAR EMAIL
  // ============================================================

  async changeEmail(userId: string, newEmail: string, auditContext: AdminAuditContext) {
    const { user, oldEmail, updatedEmail } = await this.unitOfWork.run(async () => {
      const user = await this.userRepository.findAdminTarget(userId);

      if (!user) {
        throw AppError.notFound('Usuario no encontrado');
      }
      assertNotDeleted(user);

      const { oldEmail, newEmail: updatedEmail } = await this.profileHelper.updateEmailLogic({
        userId,
        personId: requirePerson(user).personId,
        newEmail,
        changedByUserId: auditContext.adminUserId,
        changedByRole: 'admin',
        changeReason: 'Email actualizado por administrador',
        auditContext: { ipAddress: auditContext.ipAddress, userAgent: auditContext.userAgent },
        skipVerificationCheck: true
      });
      return { user, oldEmail, updatedEmail };
    });

    await audit.record('PERSON_EMAIL_CHANGED', {
      actorId: auditContext.adminUserId,
      details: {
        before: { email: oldEmail },
        after: { email: updatedEmail }
      },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    const firstName = user.person?.firstName;

    setImmediate(() => {
      this.notifier.notifyEmail({
        type: 'EMAIL_CHANGED_OLD',
        email: oldEmail,
        metadata: { nombre: firstName, email: oldEmail, logoUrl: notifications.ses.logoUrl }
      }).catch(err => logger.warn('Error sending old email notification', { error: err.message }));

      this.notifier.notify({
        type: 'EMAIL_CHANGED_NEW',
        userId: user.userId,
        relatedEntity: null,
        metadata: { nombre: firstName, email: updatedEmail, logoUrl: notifications.ses.logoUrl }
      }).catch(err => logger.warn('Error sending new email notification', { error: err.message }));

      this.notifier.notify({
        type: 'PERSON_ADMIN_ACTION',
        userId: auditContext.adminUserId,
        relatedEntity: null,
        metadata: {
          nombre: auditContext.adminFirstName,
          accion: 'cambiar_email',
          userId: userId,
          logoUrl: notifications.ses.logoUrl
        }
      }).catch(err => logger.warn('Error sending admin action notification', { error: err.message }));
    });

    return ChangeEmailDTO(user, oldEmail, updatedEmail);
  }

  // ============================================================
  // CAMBIAR NATIONAL ID
  // ============================================================

  async changeNationalId(userId: string, newNationalId: string, auditContext: AdminAuditContext) {
    const { user, oldNationalId, updated, unchanged } = await this.unitOfWork.run(async () => {
      const user = await this.userRepository.findAdminTarget(userId);

      if (!user) {
        throw AppError.notFound('Usuario no encontrado');
      }
      assertNotDeleted(user);

      const {
        oldNationalId,
        newNationalId: updated,
        unchanged
      } = await this.profileHelper.updateNationalIdLogic({
        userId,
        personId: requirePerson(user).personId,
        newNationalId,
        role: user.role ?? { name: '' }, // sin rol cargado no hay regla de formato que aplicar
        changedByUserId: auditContext.adminUserId,
        changedByRole: 'admin',
        changeReason: 'National ID actualizado por administrador',
        auditContext: { ipAddress: auditContext.ipAddress, userAgent: auditContext.userAgent }
      });
      return { user, oldNationalId, updated, unchanged };
    });

    // Idempotente: el valor enviado es igual al actual — no hubo cambio real,
    // se omite auditoría, re-screening SARLAFT y notificaciones; se responde OK.
    if (unchanged) {
      return ChangeNationalIdDTO(user, oldNationalId, updated);
    }

    await audit.record('PERSON_NATIONAL_ID_CHANGED', {
      actorId: auditContext.adminUserId,
      details: {
        before: { nationalId: oldNationalId },
        after: { nationalId: updated }
      },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    const affectedEmail = user.person?.contact?.email;
    const firstName = user.person?.firstName;

    setImmediate(() => {
      this.notifier.notify({
        type: 'NATIONAL_ID_CHANGED',
        userId: user.userId,
        relatedEntity: null,
        metadata: { nombre: firstName, email: affectedEmail, logoUrl: notifications.ses.logoUrl }
      }).catch(err => logger.warn('Error sending national id notification', { error: err.message }));

      this.notifier.notify({
        type: 'PERSON_ADMIN_ACTION',
        userId: auditContext.adminUserId,
        relatedEntity: null,
        metadata: {
          nombre: auditContext.adminFirstName,
          accion: 'cambiar_national_id',
          userId: userId,
          logoUrl: notifications.ses.logoUrl
        }
      }).catch(err => logger.warn('Error sending admin action notification', { error: err.message }));
    });

    return ChangeNationalIdDTO(user, oldNationalId, updated);
  }

  // ============================================================
  // DESHABILITAR MFA
  // ============================================================

  async disableMFA(userId: string, auditContext: AdminAuditContext) {
    const user = await this.unitOfWork.run(async () => {
      const user = await this.userRepository.findAdminTarget(userId);

      if (!user) {
        throw AppError.notFound('Usuario no encontrado');
      }
      assertNotDeleted(user);
      if (!user.totpEnabled && !user.smsMfaEnabled) {
        throw AppError.badRequest('El usuario no tiene MFA habilitado');
      }

      const updates: Prisma.UserUncheckedUpdateManyInput = { preferredMfaMethod: 'none' };
      if (user.totpEnabled) {
        updates.totpEnabled = false;
        updates.totpSecret = null;
      }
      if (user.smsMfaEnabled) {
        updates.smsMfaEnabled = false;
      }

      await this.userRepository.update(userId, updates);

      await KycSharedUtil.logChange({
        userId: user.userId,
        changedByUserId: auditContext.adminUserId,
        changedByRole: 'admin',
        changeType: 'mfa_status',
        previousValue: 'enabled',
        newValue: 'disabled',
        changeReason: 'MFA desactivado por administrador',
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent
      });
      return user;
    });

    await audit.record('PERSON_MFA_DISABLED', {
      actorId: auditContext.adminUserId,
      details: {
        before: { mfaEnabled: true },
        after: { mfaEnabled: false }
      },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    this._notifyMFADisabled(user, userId, auditContext);

    user.totpEnabled = false;
    user.smsMfaEnabled = false;
    user.preferredMfaMethod = 'none';
    return DisableMFADTO(user);
  }

  /** @private Dispara en background las notificaciones de desactivación de MFA. */
  _notifyMFADisabled(user: UserAdminTargetRow, userId: string, auditContext: AdminAuditContext) {
    const affectedNombre = user.person?.firstName || 'Usuario';
    const affectedEmail = user.person?.contact?.email;

    setImmediate(() => {
      this.notifier.notify({
        type: 'RESET_MFA',
        userId: user.userId,
        relatedEntity: null,
        metadata: {
          nombre: affectedNombre,
          email: affectedEmail,
          logoUrl: notifications.ses.logoUrl
        }
      }).catch(err => logger.warn('Error sending MFA reset notification', { error: err.message }));

      this.notifier.notify({
        type: 'PERSON_ADMIN_ACTION',
        userId: auditContext.adminUserId,
        relatedEntity: null,
        metadata: {
          nombre: auditContext.adminFirstName,
          accion: 'deshabilitar_mfa',
          userId: userId,
          logoUrl: notifications.ses.logoUrl
        }
      }).catch(err => logger.warn('Error sending admin action notification', { error: err.message }));
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace PersonCredentialsService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    unitOfWork?: typeof unitOfWork;
    profileHelper?: typeof ProfileHelper;
    userRepository?: typeof userRepository;
    notifier?: typeof notifier;
  }
}

export default PersonCredentialsService;
