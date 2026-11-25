// Reglas del dominio iam: roles, cuentas, sesiones, dispositivos, login, MFA, biometría, reset y RBAC.
import {
  assertNotDeleted,
  displayName,
  hasActiveMfa,
  isClientRole,
  isInternalRole,
  isSuperAdminRole,
  loginHandle
} from './user';
import { exceededAbsoluteLifetime, idleMs, isIdleTooLong, shouldTouch, sweepCutoffs, sweepReason, type SessionPolicy } from './session';
import {
  assertActsFromTrusted,
  assertApprovable,
  assertBlockable,
  assertCanBlock,
  assertNotLastTrusted,
  assertUnblockable,
  requireDevice
} from './trusted-device';
import { accountBlockedError, assertPortalAccess, policyPending } from './login';
import { preferredAfterDisablingSms, preferredAfterDisablingTotp, preferredAfterEnabling, truncatedCode } from './mfa';
import { assertChallengeFor, isReplayedSignCount, type BiometricChallenge } from './biometric';
import { resetLink, resetNotificationTypes } from './credential-reset';
import { toUserRef } from './user-ref';
import {
  assertRbacRole,
  can,
  effectivePermissions,
  grantedByBase,
  isKnownRole,
  permissionCatalog,
  rbacRoleNames,
  roleMatrixEntry
} from './rbac';
import {
  DeviceBlockedError,
  DeviceNotFoundError,
  IamForbiddenError,
  IamInvalidInputError,
  IamRateLimitedError,
  InvalidBiometricChallengeError,
  MfaRequiredError,
  SessionClosedError,
  UserDeletedError
} from './errors';

const POLICY: SessionPolicy = { maxActiveSessions: 3, inactivityMinutes: 15, accessThrottleSeconds: 60, absoluteLifetimeHours: 8 };
const NOW = new Date('2026-06-01T12:00:00Z').getTime();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe('cuentas y roles', () => {
  it('clasifica los roles: internos, superadmin y cliente', () => {
    expect(['SUPERADMIN', 'ADMIN', 'AUDITOR'].every(isInternalRole)).toBe(true);
    expect(isInternalRole('CLIENTE')).toBe(false);
    expect(isInternalRole(null)).toBe(false);
    expect(isSuperAdminRole('SUPERADMIN')).toBe(true);
    expect(isSuperAdminRole('ADMIN')).toBe(false);
    expect(isClientRole('CLIENTE')).toBe(true);
    expect(isClientRole(undefined)).toBe(false);
  });

  it('una cuenta eliminada no admite cambios', () => {
    expect(() => assertNotDeleted({ deletedAt: new Date() })).toThrow(UserDeletedError);
    expect(() => assertNotDeleted({ deletedAt: null })).not.toThrow();
    expect(() => assertNotDeleted(null)).not.toThrow();
  });

  it('el handle del intento es authUsername o, si falta, el username', () => {
    expect(loginHandle({ authUsername: 'user_x', username: 'x' })).toBe('user_x');
    expect(loginHandle({ authUsername: null, username: 'x' })).toBe('x');
  });

  it('el nombre para avisos une nombre y apellido, o dice "Usuario"', () => {
    expect(displayName({ person: { firstName: 'Ana', lastName: 'Pérez' } })).toBe('Ana Pérez');
    expect(displayName({ person: { firstName: 'Ana', lastName: null } })).toBe('Ana');
    expect(displayName({ person: null })).toBe('Usuario');
  });

  it('MFA activo = TOTP o SMS encendido', () => {
    expect(hasActiveMfa({ totpEnabled: true, smsMfaEnabled: false })).toBe(true);
    expect(hasActiveMfa({ totpEnabled: null, smsMfaEnabled: true })).toBe(true);
    expect(hasActiveMfa({ totpEnabled: false, smsMfaEnabled: false })).toBe(false);
    expect(hasActiveMfa(null)).toBe(false);
  });

  it('la referencia a un usuario arma el nombre completo (o null)', () => {
    expect(toUserRef({ userId: 'u1', username: 'ana', person: { firstName: 'Ana', lastName: 'Pérez' } })).toEqual({
      userId: 'u1',
      username: 'ana',
      fullName: 'Ana Pérez'
    });
    expect(toUserRef({ userId: 'u1' })).toEqual({ userId: 'u1', username: undefined, fullName: null });
    expect(toUserRef(null)).toBeNull();
  });
});

describe('sesiones', () => {
  it('el tope absoluto se cuenta desde started_at', () => {
    expect(exceededAbsoluteLifetime({ startedAt: new Date(NOW - 8 * HOUR) }, POLICY, NOW)).toBe(true);
    expect(exceededAbsoluteLifetime({ startedAt: new Date(NOW - 8 * HOUR + 1) }, POLICY, NOW)).toBe(false);
  });

  it('inactividad: más de 15 minutos cierra; el last_access_at se escribe cada 60 s como mucho', () => {
    const idle = idleMs({ lastAccessAt: new Date(NOW - 16 * MIN) }, NOW);
    expect(idle).toBe(16 * MIN);
    expect(isIdleTooLong(idle, POLICY)).toBe(true);
    expect(isIdleTooLong(15 * MIN, POLICY)).toBe(false);
    expect(shouldTouch(61 * 1000, POLICY)).toBe(true);
    expect(shouldTouch(60 * 1000, POLICY)).toBe(false);
  });

  it('el barrido corta por inactividad y por tope absoluto; prevalece el tope absoluto', () => {
    const { inactivityCutoff, absoluteCutoff } = sweepCutoffs(POLICY, NOW);
    expect(inactivityCutoff.getTime()).toBe(NOW - 15 * MIN);
    expect(absoluteCutoff.getTime()).toBe(NOW - 8 * HOUR);
    expect(sweepReason({ startedAt: new Date(NOW - 9 * HOUR) }, absoluteCutoff)).toEqual({
      reason: 'absolute_lifetime',
      auditAction: 'SESSION_ABSOLUTE_EXPIRED'
    });
    expect(sweepReason({ startedAt: new Date(NOW - HOUR) }, absoluteCutoff)).toEqual({
      reason: 'inactivity_timeout',
      auditAction: 'SESSION_EXPIRED_BY_WORKER'
    });
  });

  it('una sesión cerrada se informa con su código', () => {
    expect(new SessionClosedError().details).toEqual({ code: 'SESSION_CLOSED' });
    expect(new MfaRequiredError().details).toEqual({ code: 'MFA_REQUIRED' });
    expect(new DeviceBlockedError(null).details).toBeNull();
  });
});

describe('dispositivos de confianza', () => {
  it('solo un dispositivo trusted gestiona a los demás', () => {
    expect(() => assertActsFromTrusted(null, 'bloquear')).toThrow('Solo puedes bloquear dispositivos desde un dispositivo de confianza');
    expect(() => assertActsFromTrusted({ status: 'pending' }, 'aprobar')).toThrow(IamForbiddenError);
    expect(() => assertActsFromTrusted({ status: 'trusted' }, 'aprobar')).not.toThrow();
  });

  it('no se bloquea el propio, uno ya bloqueado ni el último trusted', () => {
    expect(() => assertCanBlock({ userTrustedDeviceId: 'd1' }, 'd1')).toThrow('No puedes bloquear tu propio dispositivo. Usa el endpoint de logout');
    expect(() => assertCanBlock({ userTrustedDeviceId: 'd1' }, 'd2')).not.toThrow();
    expect(() => assertBlockable({ status: 'blocked' })).toThrow('El dispositivo ya está bloqueado');
    expect(() => assertNotLastTrusted(1)).toThrow(IamInvalidInputError);
    expect(() => assertNotLastTrusted(2)).not.toThrow();
  });

  it('desbloquear exige blocked y aprobar exige pending', () => {
    expect(() => assertUnblockable({ status: 'trusted' })).toThrow('El dispositivo no está bloqueado');
    expect(() => assertUnblockable({ status: 'blocked' })).not.toThrow();
    expect(() => assertApprovable({ status: 'trusted' })).toThrow('El dispositivo no está pendiente de aprobación');
    expect(() => assertApprovable({ status: 'pending' })).not.toThrow();
  });

  it('un dispositivo que no está es un 404', () => {
    expect(() => requireDevice(null)).toThrow(DeviceNotFoundError);
    expect(requireDevice({ id: 1 })).toEqual({ id: 1 });
  });
});

describe('login', () => {
  const role = (name: string) => ({ role: { roleId: name, name, description: null } });

  it('cada rol entra solo a su portal; sin portal no se restringe', () => {
    expect(() => assertPortalAccess(role('ADMIN'), 'admin')).not.toThrow();
    expect(() => assertPortalAccess(role('AUDITOR'), 'admin')).not.toThrow();
    expect(() => assertPortalAccess(role('CLIENTE'), 'admin')).toThrow('No tienes permiso para acceder a este portal');
    expect(() => assertPortalAccess(role('ADMIN'), 'client')).toThrow(IamForbiddenError);
    expect(() => assertPortalAccess({ role: null }, 'client')).toThrow(IamForbiddenError);
    expect(() => assertPortalAccess(role('CLIENTE'), null)).not.toThrow();
  });

  it('la política bloquea solo a clientes con otra versión, si hay una activa', () => {
    const policy = { privacyPolicyId: 'p2', version: '2.0', documentUrl: 'u', summary: null, effectiveDate: '2026-01-01' };
    expect(policyPending({ ...role('CLIENTE'), privacyPolicyVersion: '1.0' }, policy)).toBe(true);
    expect(policyPending({ ...role('CLIENTE'), privacyPolicyVersion: '2.0' }, policy)).toBe(false);
    expect(policyPending({ ...role('CLIENTE'), privacyPolicyVersion: '1.0' }, null)).toBe(false);
    expect(policyPending({ ...role('ADMIN'), privacyPolicyVersion: null }, policy)).toBe(false);
  });

  it('el bloqueo por intentos redondea los minutos hacia arriba y lleva el Retry-After', () => {
    const error = accountBlockedError(61);
    expect(error).toBeInstanceOf(IamRateLimitedError);
    expect(error.message).toBe('Cuenta bloqueada temporalmente. Intenta nuevamente en 2 minuto(s)');
    expect(error.retryAfterSeconds).toBe(61);
  });
});

describe('MFA', () => {
  it('el primer factor activado queda como preferido', () => {
    expect(preferredAfterEnabling({ preferredMfaMethod: 'none' }, 'totp')).toBe('totp');
    expect(preferredAfterEnabling({ preferredMfaMethod: 'sms' }, 'totp')).toBeNull();
  });

  it('al apagar el preferido cae al otro factor si sigue activo, o a none', () => {
    expect(preferredAfterDisablingTotp({ preferredMfaMethod: 'totp', smsMfaEnabled: true })).toBe('sms');
    expect(preferredAfterDisablingTotp({ preferredMfaMethod: 'totp', smsMfaEnabled: false })).toBe('none');
    expect(preferredAfterDisablingTotp({ preferredMfaMethod: 'sms', smsMfaEnabled: true })).toBeNull();
    expect(preferredAfterDisablingSms({ preferredMfaMethod: 'sms', totpEnabled: true })).toBe('totp');
    expect(preferredAfterDisablingSms({ preferredMfaMethod: 'sms', totpEnabled: null })).toBe('none');
    expect(preferredAfterDisablingSms({ preferredMfaMethod: 'totp', totpEnabled: true })).toBeNull();
  });

  it('el código truncado solo muestra los dos últimos dígitos', () => {
    expect(truncatedCode('123456')).toBe('****56');
  });
});

describe('biometría', () => {
  const challenge = (over: Partial<BiometricChallenge> = {}): BiometricChallenge => ({
    biometricChallengeId: 'c1',
    userId: 'u1',
    challenge: 'abc',
    type: 'authentication',
    used: false,
    expiresAt: new Date(),
    createdAt: new Date(),
    ...over
  });

  it('el challenge debe existir, ser del usuario y del tipo del paso', () => {
    expect(() => assertChallengeFor(null, 'u1', 'authentication')).toThrow(InvalidBiometricChallengeError);
    expect(() => assertChallengeFor(challenge({ userId: 'u2' }), 'u1', 'authentication')).toThrow('El challenge no pertenece a este usuario');
    expect(() => assertChallengeFor(challenge(), 'u1', 'registration')).toThrow('Tipo de challenge incorrecto');
    expect(() => assertChallengeFor(challenge(), 'u1', 'authentication')).not.toThrow();
  });

  it('un sign_count que no crece es una firma repetida', () => {
    expect(isReplayedSignCount({ signCount: 5 }, 5)).toBe(true);
    expect(isReplayedSignCount({ signCount: 5 }, 4)).toBe(true);
    expect(isReplayedSignCount({ signCount: 5 }, 6)).toBe(false);
  });
});

describe('reset de credenciales', () => {
  it('el enlace apunta a la ruta del front de cada tipo', () => {
    expect(resetLink('https://f.test/reset', 'password', 'tok')).toBe('https://f.test/reset-password?token=tok&type=password');
    expect(resetLink('https://f.test/reset', 'mfa', 'tok')).toBe('https://f.test/reset-totp?token=tok&type=mfa');
  });

  it('cada tipo tiene su aviso de pedido, de confirmación y su acción auditada', () => {
    expect(resetNotificationTypes('password')).toEqual({ request: 'SOLICITUD_RESET_PASSWORD', confirmed: 'RESET_PASSWORD', audit: 'PASSWORD_RESET_CONFIRMED' });
    expect(resetNotificationTypes('mfa')).toEqual({ request: 'SOLICITUD_RESET_MFA', confirmed: 'RESET_MFA', audit: 'MFA_RESET_CONFIRMED' });
  });
});

describe('RBAC', () => {
  it('matriz base: SUPERADMIN y ADMIN todo, AUDITOR solo lectura, CLIENTE nada', () => {
    expect(grantedByBase('SUPERADMIN', 'internalUsers', 'delete')).toBe(true);
    expect(grantedByBase('ADMIN', 'systemConfig', 'update')).toBe(true);
    expect(grantedByBase('AUDITOR', 'globalLogs', 'read')).toBe(true);
    expect(grantedByBase('AUDITOR', 'globalLogs', 'update')).toBe(false);
    expect(grantedByBase('CLIENTE', 'clientsList', 'read')).toBe(false);
    expect(grantedByBase('DESCONOCIDO', 'clientsList', 'read')).toBe(false);
  });

  it('los overrides solo suman, y un rol desconocido no tiene nada ni por override', () => {
    const overrides = [{ moduleName: 'clientsList', action: 'update' }];
    expect(can('AUDITOR', 'clientsList', 'update', overrides)).toBe(true);
    expect(can('AUDITOR', 'clientsList', 'delete', overrides)).toBe(false);
    expect(isKnownRole('DESCONOCIDO')).toBe(false);
    expect(can('DESCONOCIDO', 'clientsList', 'update', overrides)).toBe(false);
  });

  it('permisos efectivos: AUDITOR lee todos los módulos; CLIENTE no tiene ninguno', () => {
    const auditor = effectivePermissions('AUDITOR', []);
    expect(Object.keys(auditor)).toEqual(permissionCatalog().modules);
    expect(Object.values(auditor).every(actions => actions.length === 1 && actions[0] === 'read')).toBe(true);
    expect(effectivePermissions('CLIENTE', [])).toEqual({});
  });

  it('la matriz separa lo de la base de lo agregado (sin repetir un override ya cubierto)', () => {
    const entry = roleMatrixEntry('AUDITOR', [
      { moduleName: 'clientsList', action: 'update' },
      { moduleName: 'clientsList', action: 'read' }
    ]);
    expect(entry.role).toBe('AUDITOR');
    expect(entry.basePermissions.clientsList).toEqual(['read']);
    expect(entry.addedPermissions).toEqual({ clientsList: ['update'] });
  });

  it('el catálogo expone grupos, módulos y acciones; los roles RBAC son los de la matriz', () => {
    const catalog = permissionCatalog();
    expect(catalog.actions).toEqual(['create', 'read', 'update', 'delete']);
    expect(catalog.modules).toContain('internalUsers');
    expect(catalog.groups.length).toBeGreaterThan(0);
    expect(rbacRoleNames()).toEqual(['SUPERADMIN', 'ADMIN', 'AUDITOR', 'CLIENTE']);
    expect(() => assertRbacRole('ROOT')).toThrow("El rol 'ROOT' no es un rol RBAC válido");
    expect(() => assertRbacRole('AUDITOR')).not.toThrow();
  });
});
