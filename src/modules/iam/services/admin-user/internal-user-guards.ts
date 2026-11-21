import type { User } from '../../../../shared/infrastructure/database/generated/prisma/client';
import personModule from '../../../person';
const { personGuards: personGuardsModule } = personModule;
const { requirePerson } = personGuardsModule;
// modules/admin/kyc/iam/services/admin-user/internal-user-guards.ts
//
// Reglas y lecturas compartidas por los servicios de gestión de usuarios internos
// (equivalente a person-guards.js en admin-person). Extraído de AdminUserService (SOLID: S).

import userRepository from '../../repositories/user.repository';
import roleRepository from '../../repositories/role.repository';
import userSessionRepository from '../../repositories/user-session.repository';
import TokenBlacklistUtil from '../../utils/token-blacklist.util';
import AppError from '../../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../../shared/infrastructure/config';
const { INTERNAL_ROLE_NAMES, SUPERADMIN_ROLE_NAMES } = constantsModule;

class InternalUserGuards {
  userRepository: typeof userRepository;
  roleRepository: typeof roleRepository;
  userSessionRepository: typeof userSessionRepository;

  /** @param {object} [deps] Dependencias inyectables (SOLID: D). */
  constructor(deps: InternalUserGuards.Deps = {}) {
    this.userRepository = deps.userRepository ?? userRepository;
    this.roleRepository = deps.roleRepository ?? roleRepository;
    this.userSessionRepository = deps.userSessionRepository ?? userSessionRepository;
  }

  isInternalRole(roleName: string | null | undefined) {
    return !!roleName && INTERNAL_ROLE_NAMES.includes(roleName);
  }

  isSuperAdminRole(roleName: string | null | undefined) {
    return !!roleName && SUPERADMIN_ROLE_NAMES.includes(roleName);
  }

  /**
   * Bloquea toda operación de escritura sobre un usuario eliminado (deleted_at != null).
   * Las cuentas eliminadas son intocables: no se editan, no cambian de rol/estado, no se re-eliminan.
   */
  assertNotDeleted(user: Pick<User, 'deletedAt'> | null | undefined) {
    if (user?.deletedAt) {
      throw AppError.conflict('El usuario está eliminado y no admite modificaciones', { code: 'USER_DELETED' });
    }
  }

  /** Persona asociada al usuario (siempre existe: person_id es NOT NULL); si falta, el include no la trajo. */
  requirePerson<P>(user: { person?: P | null }): P {
    return requirePerson(user);
  }

  async getInternalUserOrFail(userId: string) {
    const user = await this.userRepository.findByUserId(userId, 'basic');
    if (!user) {
      throw AppError.notFound('Usuario no encontrado');
    }
    if (!this.isInternalRole(user.role?.name)) {
      throw AppError.notFound('Usuario interno no encontrado');
    }
    return user;
  }

  async getInternalRoleOrFail(roleId: string) {
    const role = await this.roleRepository.findById(roleId);
    if (!role) {
      throw AppError.notFound('Rol no encontrado');
    }
    if (!this.isInternalRole(role.name)) {
      throw AppError.badRequest('El rol indicado no es un rol interno');
    }
    return role;
  }

  /**
   * IDs de los roles internos visibles en el listado. Excluye superadministradores:
   * nunca se listan usuarios internos con rol superadmin en la gestión de usuarios.
   */
  async listableInternalRoleIds() {
    const roles = await this.roleRepository.findByNames(INTERNAL_ROLE_NAMES, { exclude: SUPERADMIN_ROLE_NAMES });
    return roles.map(r => r.roleId);
  }

  /** Cierra sesiones en BD y las invalida en Redis. */
  async invalidateSessions(userId: string, reason: string) {
    await this.userSessionRepository.closeAllByUser(userId, reason);
    await TokenBlacklistUtil.invalidateUserSessions(userId).catch(err =>
      logger.warn('Error invalidando sesiones en Redis', { error: err.message, userId })
    );
  }
}

/** Nombre completo para notificaciones ("Usuario" si no hay datos). */
function displayName(user: { person?: { firstName?: string | null; lastName?: string | null } | null }) {
  return [user.person?.firstName, user.person?.lastName].filter(Boolean).join(' ') || 'Usuario';
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace InternalUserGuards {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userRepository?: typeof userRepository;
    roleRepository?: typeof roleRepository;
    userSessionRepository?: typeof userSessionRepository;
  }
}

export default { InternalUserGuards, displayName };
