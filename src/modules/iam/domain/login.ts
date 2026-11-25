// Reglas del inicio de sesión: a qué portal puede entrar cada rol, cuándo la política de privacidad bloquea el
// acceso y cómo se avisa un bloqueo por intentos.
import rbacModule from '../../../shared/domain/constants/rbac';
import { IamForbiddenError, IamRateLimitedError } from './errors';
import { isInternalRole, type LoginUser } from './user';

const { INTERNAL_ROLE_NAMES, RBAC_ROLES } = rbacModule;

const SECONDS_PER_MINUTE = 60;

/** Portal desde el que llega el login (lo marca la ruta: /admin o /client). */
export type ServerContext = 'admin' | 'client' | string;

const PORTAL_ROLES: Record<string, readonly string[] | undefined> = {
  // El portal admin admite todos los roles INTERNOS (SUPERADMIN/ADMIN/AUDITOR). Qué puede hacer cada uno lo decide
  // el RBAC por ruta; aquí solo se controla el acceso al portal.
  admin: [...INTERNAL_ROLE_NAMES],
  // El portal cliente admite el rol CLIENTE.
  client: [RBAC_ROLES.CLIENTE]
};

/** Un rol solo entra a su portal. Sin portal (llamada interna) no se restringe. */
export function assertPortalAccess(user: Pick<LoginUser, 'role'>, serverContext: ServerContext | null | undefined): void {
  if (!serverContext) {
    return;
  }
  const allowed = PORTAL_ROLES[serverContext];
  if (allowed && !(user.role && allowed.includes(user.role.name))) {
    throw new IamForbiddenError('No tienes permiso para acceder a este portal');
  }
}

/** La política de privacidad vigente (de legal). */
export interface ActivePolicy {
  privacyPolicyId: string;
  version: string;
  documentUrl: string;
  summary: string | null;
  effectiveDate: Date | string;
}

/**
 * ¿La política bloquea el login? Los internos no están sujetos a la política de clientes; sin política activa o
 * con la versión vigente ya aceptada, no hay nada que pedir.
 */
export function policyPending(user: Pick<LoginUser, 'role' | 'privacyPolicyVersion'>, activePolicy: ActivePolicy | null): activePolicy is ActivePolicy {
  if (user.role && isInternalRole(user.role.name)) {
    return false;
  }
  if (!activePolicy) {
    return false;
  }
  return user.privacyPolicyVersion !== activePolicy.version;
}

/** Cuenta bloqueada por intentos fallidos: cuántos minutos faltan (redondeo hacia arriba). */
export function accountBlockedError(retrySeconds: number, minutes = Math.ceil(retrySeconds / SECONDS_PER_MINUTE)) {
  return new IamRateLimitedError(`Cuenta bloqueada temporalmente. Intenta nuevamente en ${minutes} minuto(s)`, retrySeconds);
}
