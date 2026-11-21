import MaskingUtil from '../../../shared/security/masking.util';
import { z } from '../../../shared/validation/z';
import { dateTime } from '../../../shared/validation/output';
import type { DbDate, Maybe, UserRefRow } from '../../../shared/types/db-rows';

/** Fila de Prisma (verification_codes migró en la fase 5, grupo 3). */
interface VerificationCodeRow {
  verificationCodeId: string;
  type: string;
  contactValue?: Maybe<string>;
  attempts?: Maybe<number>;
  expiresAt: DbDate;
  verifiedAt?: Maybe<DbDate>;
  createdAt?: Maybe<DbDate>;
}

/** Fila de Prisma (user_login_attempts). */
interface UserChangeLogRow {
  logId: string;
  userId: string;
  user?: Maybe<UserRefRow>;
  changedByUserId?: Maybe<string>;
  changedByRole?: Maybe<string>;
  changedBy?: Maybe<UserRefRow>;
  changeType: string;
  previousValue?: unknown;
  newValue?: unknown;
  changeReason?: Maybe<string>;
  ipAddress?: Maybe<string>;
  userAgent?: Maybe<string>;
  originSessionId?: Maybe<string>;
  createdAt?: Maybe<DbDate>;
}

interface UserSessionRow {
  userSessionId: string;
  status: string;
  ipAddress?: Maybe<string>;
  userAgent?: Maybe<string>;
  startedAt?: Maybe<DbDate>;
  lastAccessAt?: Maybe<DbDate>;
  closedAt?: Maybe<DbDate>;
  closeReason?: Maybe<string>;
  createdAt?: Maybe<DbDate>;
  sessionUser?: Maybe<UserRefRow>;
}

interface TrustedDeviceRow {
  userTrustedDeviceId: string;
  userId: string;
  deviceName?: Maybe<string>;
  fingerprintHash?: Maybe<string>;
  status: string;
  ipAddress?: Maybe<string>;
  city?: Maybe<string>;
  country?: Maybe<string>;
  countryCode?: Maybe<string>;
  browser?: Maybe<string>;
  os?: Maybe<string>;
  deviceType?: Maybe<string>;
  approvedByDeviceId?: Maybe<string>;
  approvedAt?: Maybe<DbDate>;
  blockedByDeviceId?: Maybe<string>;
  blockedAt?: Maybe<DbDate>;
  trustedAt?: Maybe<DbDate>;
  lastSeenAt?: Maybe<DbDate>;
  createdAt?: Maybe<DbDate>;
  updatedAt?: Maybe<DbDate>;
  /** Última sesión del dispositivo (include con take 1) */
  sessions?: Maybe<UserSessionRow[]>;
}

interface BiometricCredentialRow {
  userBiometricCredentialId: string;
  userTrustedDeviceId: string;
  credentialId: string;
  signCount: number;
  isActive: boolean;
  lastUsedAt?: Maybe<DbDate>;
  createdAt?: Maybe<DbDate>;
}

function _buildUserRef(user: Maybe<UserRefRow>) {
  if (!user) {
    return null;
  }
  return {
    userId: user.userId,
    username: user.username,
    fullName: [user.person?.firstName, user.person?.lastName].filter(Boolean).join(' ') || null
  };
}

// ============================================================
// VERIFICATION CODE
// ============================================================

class VerificationCodeComponent {
  static build(verificationCode: Maybe<VerificationCodeRow>) {
    if (!verificationCode) {
      return null;
    }
    return {
      verificationCodeId: verificationCode.verificationCodeId,
      type: verificationCode.type,
      // [RF-USR-01] | CA-06 | Destino del OTP: correo o celular según el tipo → máscara por forma.
      contactValue: MaskingUtil.maskAuto(verificationCode.contactValue),
      attempts: verificationCode.attempts,
      expiresAt: verificationCode.expiresAt,
      verifiedAt: verificationCode.verifiedAt || null,
      isVerified: !!verificationCode.verifiedAt,
      isExpired: new Date() > new Date(verificationCode.expiresAt),
      createdAt: verificationCode.createdAt
    };
  }
}

// ============================================================
// USER CHANGE LOG
// ============================================================

const SENSITIVE_LOG_TYPES = new Set(['email', 'phone', 'national_id']);

function _maskLogValue(value: unknown, changeType: string): unknown {
  if (!value) {
    return value;
  }
  if (changeType === 'email') {
    return MaskingUtil.maskEmail(value);
  }
  if (SENSITIVE_LOG_TYPES.has(changeType)) {
    return MaskingUtil.maskDocumentId(value);
  }
  // [RF-USR-01] | CA-06 | Red para los change_type que no están en la lista: si el valor TIENE forma
  // de correo o de número (documento/celular) se enmascara; un estado como 'activo' pasa intacto.
  return MaskingUtil.maskAuto(value);
}

class UserChangeLogComponent {
  static build(log: Maybe<UserChangeLogRow>) {
    if (!log) {
      return null;
    }
    return {
      logId: log.logId,
      userId: log.userId,
      user: _buildUserRef(log.user),
      changedByUserId: log.changedByUserId || null,
      changedByRole: log.changedByRole,
      changedBy: _buildUserRef(log.changedBy),
      changeType: log.changeType,
      previousValue: _maskLogValue(log.previousValue, log.changeType),
      newValue: _maskLogValue(log.newValue, log.changeType),
      changeReason: log.changeReason || null,
      ipAddress: log.ipAddress || null,
      userAgent: log.userAgent || null,
      // Alinea esta tabla de auditoría con audit_logs.session_id (consistencia pedida en §3 Fase 3).
      originSessionId: log.originSessionId || null,
      createdAt: log.createdAt
    };
  }

  static buildArray(logs: Maybe<UserChangeLogRow[]>) {
    if (!logs || logs.length === 0) {
      return [];
    }
    return logs.map(l => UserChangeLogComponent.build(l));
  }
}

// ============================================================
// USER SESSION
// ============================================================

class UserSessionComponent {
  static build(session: Maybe<UserSessionRow>) {
    if (!session) {
      return null;
    }
    return {
      sessionId: session.userSessionId,
      status: session.status,
      ipAddress: session.ipAddress || null,
      userAgent: session.userAgent || null,
      startedAt: session.startedAt,
      lastAccessAt: session.lastAccessAt,
      closedAt: session.closedAt || null,
      closeReason: session.closeReason || null,
      createdAt: session.createdAt,
      user: _buildUserRef(session.sessionUser)
    };
  }

  static buildArray(sessions: Maybe<UserSessionRow[]>) {
    if (!sessions || sessions.length === 0) {
      return [];
    }
    return sessions.map(s => UserSessionComponent.build(s));
  }
}

// ============================================================
// TRUSTED DEVICE
// ============================================================

class TrustedDeviceComponent {
  static build(
    device: Maybe<TrustedDeviceRow>,
    currentFingerprintHash: string | null = null,
    currentSessionId: string | null = null
  ) {
    if (!device) {
      return null;
    }

    const activeSession = device.sessions?.[0] ? UserSessionComponent.build(device.sessions[0]) : null;

    const isCurrent = currentSessionId
      ? activeSession?.sessionId === currentSessionId
      : currentFingerprintHash
        ? device.fingerprintHash === currentFingerprintHash
        : false;

    return {
      userTrustedDeviceId: device.userTrustedDeviceId,
      userId: device.userId,
      deviceName: device.deviceName,
      fingerprintHash: device.fingerprintHash,
      isCurrent,
      status: device.status,
      isPending: device.status === 'pending',
      ipAddress: device.ipAddress || null,
      city: device.city || null,
      country: device.country || null,
      countryCode: device.countryCode || null,
      browser: device.browser || null,
      os: device.os || null,
      deviceType: device.deviceType || 'desktop',
      approvedByDeviceId: device.approvedByDeviceId || null,
      approvedAt: device.approvedAt || null,
      blockedByDeviceId: device.blockedByDeviceId || null,
      blockedAt: device.blockedAt || null,
      activeSession,
      trustedAt: device.trustedAt,
      lastSeenAt: device.lastSeenAt,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt
    };
  }

  static buildArray(
    devices: Maybe<TrustedDeviceRow[]>,
    currentFingerprintHash: string | null = null,
    currentSessionId: string | null = null
  ) {
    if (!devices || devices.length === 0) {
      return [];
    }
    return devices.map(d => TrustedDeviceComponent.build(d, currentFingerprintHash, currentSessionId));
  }
}

// ============================================================
// BIOMETRIC CREDENTIAL
// ============================================================

class BiometricCredentialComponent {
  static build(credential: Maybe<BiometricCredentialRow>) {
    if (!credential) {
      return null;
    }
    return {
      biometricCredentialId: credential.userBiometricCredentialId,
      deviceId: credential.userTrustedDeviceId,
      credentialId: credential.credentialId,
      signCount: credential.signCount,
      isActive: credential.isActive,
      lastUsedAt: credential.lastUsedAt || null,
      createdAt: credential.createdAt
    };
  }

  static buildArray(credentials: Maybe<BiometricCredentialRow[]>) {
    if (!credentials || credentials.length === 0) {
      return [];
    }
    return credentials.map(c => BiometricCredentialComponent.build(c)).filter(Boolean);
  }
}

export default {
  VerificationCodeComponent,
  UserChangeLogComponent,
  BiometricCredentialComponent,
  UserSessionComponent,
  TrustedDeviceComponent
};

// ============================================================
// ESQUEMAS DE SALIDA
// ============================================================

export const UserRefSchema = z.object({
  userId: z.uuid(),
  username: z.string().nullish().meta({ example: 'jdoe' }),
  fullName: z.string().nullable().meta({ example: 'John Doe' })
});

export const UserSessionSchema = z.object({
  sessionId: z.uuid(),
  status: z.string().meta({ example: 'active', description: 'active | closed' }),
  ipAddress: z.string().nullable().meta({ example: '190.114.45.227' }),
  userAgent: z.string().nullable(),
  startedAt: dateTime(),
  lastAccessAt: dateTime(),
  closedAt: dateTime().nullable(),
  closeReason: z.string().nullable().meta({ example: 'revoked_by_admin' }),
  createdAt: dateTime(),
  user: UserRefSchema.nullable()
});

export const UserChangeLogSchema = z
  .object({
    logId: z.uuid(),
    userId: z.uuid().nullable().meta({ description: 'Usuario afectado por el cambio.' }),
    user: UserRefSchema.nullable(),
    changedByUserId: z.uuid().nullable().meta({ description: 'Usuario que hizo el cambio.' }),
    changedByRole: z.string().meta({ example: 'admin', description: 'user | admin | system' }),
    changedBy: UserRefSchema.nullable().meta({ description: 'null si lo hizo el sistema.' }),
    changeType: z.string().meta({ example: 'email', description: 'Campo o entidad que cambió.' }),
    previousValue: z
      .string()
      .nullable()
      .meta({ description: 'Valor anterior. Correos, documentos y teléfonos salen enmascarados; contraseñas como `hidden`.' }),
    newValue: z.string().nullable().meta({ description: 'Valor nuevo. Mismo enmascaramiento que `previousValue`.' }),
    changeReason: z.string().nullable(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    originSessionId: z.uuid().nullable().meta({ description: 'Sesión desde la que se hizo. null si fue un worker.' }),
    createdAt: dateTime()
  })
  .meta({ description: 'Cambio sobre los datos de una cuenta (vista sobre audit_logs).' });

export const VerificationCodeSchema = z.object({
  verificationCodeId: z.uuid(),
  type: z.string().meta({ example: 'email' }),
  contactValue: z.string().nullable().meta({ description: 'Correo o teléfono, enmascarado.' }),
  attempts: z.number().int().nullable(),
  expiresAt: dateTime(),
  verifiedAt: dateTime().nullable(),
  isVerified: z.boolean(),
  isExpired: z.boolean(),
  createdAt: dateTime().nullable()
});

export const TrustedDeviceSchema = z
  .object({
    userTrustedDeviceId: z.uuid(),
    userId: z.uuid(),
    deviceName: z.string().nullable().meta({ example: 'iPhone de Ana' }),
    fingerprintHash: z.string().nullable(),
    isCurrent: z.boolean().meta({ description: 'true si es el dispositivo desde el que se hace la consulta.' }),
    status: z.string().meta({ example: 'trusted', description: 'pending | trusted | blocked' }),
    isPending: z.boolean(),
    ipAddress: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
    countryCode: z.string().nullable().meta({ example: 'CO' }),
    browser: z.string().nullable().meta({ example: 'Chrome' }),
    os: z.string().nullable().meta({ example: 'iOS' }),
    deviceType: z.string().meta({ example: 'mobile' }),
    approvedByDeviceId: z.uuid().nullable(),
    approvedAt: dateTime().nullable(),
    blockedByDeviceId: z.uuid().nullable(),
    blockedAt: dateTime().nullable(),
    activeSession: UserSessionSchema.nullable().meta({ description: 'Última sesión del dispositivo.' }),
    trustedAt: dateTime().nullable(),
    lastSeenAt: dateTime().nullable(),
    createdAt: dateTime(),
    updatedAt: dateTime()
  })
  .meta({ description: 'Dispositivo de confianza del usuario.' });

export const BiometricCredentialSchema = z.object({
  biometricCredentialId: z.uuid(),
  deviceId: z.uuid().meta({ description: 'Dispositivo de confianza al que está atada la credencial.' }),
  credentialId: z.string().meta({ description: 'ID de la credencial WebAuthn (base64url).' }),
  signCount: z.number().int(),
  isActive: z.boolean(),
  lastUsedAt: dateTime().nullable(),
  createdAt: dateTime()
});
