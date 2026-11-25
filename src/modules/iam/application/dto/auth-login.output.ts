// Salidas del login: tokens, reto MFA, política pendiente y dispositivos de confianza.
import { toContactOutput, toLocationOutput, toPersonOutput, toUserOutput } from '../../../../shared/application/account-views';
import type { LoginUser, UserProfile } from '../../domain/user';
import type { TrustedDevice } from '../../domain/trusted-device';
import type { IssuedTokens } from '../ports/auth-tokens.port';
import componentsAuthModule from './auth-components.output';
const { TrustedDeviceComponent } = componentsAuthModule;

const UserComponent = { build: toUserOutput };
const PersonComponent = { build: toPersonOutput };
const PersonContactComponent = { build: toContactOutput };
const PersonLocationComponent = { build: toLocationOutput };

/**
 * ============================================================
 * AUTH LOGIN DTOs
 * ============================================================
 */

// ============================================================
// LOGIN
// ============================================================

/** Respuesta de login exitoso (las secciones opcionales dependen de lo que trae el usuario). */
interface LoginResponse {
  user: ReturnType<typeof UserComponent.build>;
  deviceId: string | null;
  person?: ReturnType<typeof PersonComponent.build>;
  contact?: ReturnType<typeof PersonContactComponent.build>;
  location?: ReturnType<typeof PersonLocationComponent.build>;
  tokens?: IssuedTokens;
  hmacSecret?: string;
}

function LoginResponseDTO({
  user,
  tokens,
  deviceId,
  includeTokens = true,
  deviceHmacSecret = null
}: {
  /** Usuario de login (persona + contacto + rol) o con el perfil completo (también trae la ubicación). */
  user: LoginUser | UserProfile;
  tokens?: IssuedTokens | null;
  deviceId?: string | null;
  includeTokens?: boolean;
  deviceHmacSecret?: string | null;
}): LoginResponse {
  const dto: LoginResponse = {
    user: UserComponent.build(user, {
      includeRole: true,
      includeAvatar: true
    }),
    deviceId: deviceId || null
  };

  if (user.person) {
    dto.person = PersonComponent.build(user.person, {
      includeGender: true,
      includeContact: false,
      includeLocation: false
    });

    if (user.person.contact) {
      dto.contact = PersonContactComponent.build(user.person.contact);
    }

    if ('location' in user.person && user.person.location) {
      dto.location = PersonLocationComponent.build(user.person.location);
    }
  }

  if (includeTokens && tokens) {
    dto.tokens = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn
    };
  }

  // Secret HMAC único del dispositivo — solo mobile, solo en login exitoso.
  // El mobile lo guarda en su keychain y lo usa para firmar cada request.
  // La web no lo recibe — usa cookies httpOnly, no necesita HMAC.
  if (deviceHmacSecret) {
    dto.hmacSecret = deviceHmacSecret;
  }

  return dto;
}

// ============================================================
// POLICY UPDATE REQUIRED
// ============================================================

/**
 * Se retorna cuando el usuario tiene una versión antigua de la política.
 * No incluye tokens — el usuario debe aceptar y volver a hacer login.
 */
function PolicyUpdateRequiredDTO({
  currentVersion,
  newVersion,
  documentUrl,
  summary,
  effectiveDate
}: {
  currentVersion: string | null;
  newVersion: string;
  documentUrl: string;
  summary: string | null;
  effectiveDate: string | Date;
}) {
  return {
    requiresPolicyAcceptance: true,
    policy: {
      currentVersion,
      newVersion,
      documentUrl,
      summary: summary || null,
      effectiveDate: effectiveDate || null
    },
    message: 'Hay una nueva versión de la política de privacidad. Debes aceptarla para continuar.'
  };
}

// ============================================================
// DEVICE APPROVAL REQUIRED
// ============================================================

function DeviceApprovalRequiredDTO({ deviceId }: { deviceId: string }) {
  return {
    requiresDeviceApproval: true,
    deviceId,
    message: 'Dispositivo pendiente de aprobación. Apruébalo desde un dispositivo de confianza para continuar.'
  };
}

// ============================================================
// MFA
// ============================================================

function MFARequiredResponseDTO({
  username,
  session,
  challengeType,
  preferredMfaMethod
}: {
  username: string | null;
  session: string;
  challengeType: string;
  preferredMfaMethod: string;
}) {
  return {
    requiresMFA: true,
    challengeType,
    preferredMfaMethod,
    username,
    session
  };
}

// ============================================================
// REFRESH TOKEN
// ============================================================

function RefreshTokenResponseDTO({ accessToken, refreshToken, expiresIn }: IssuedTokens) {
  return { accessToken, refreshToken, expiresIn };
}

// ============================================================
// TRUSTED DEVICES
// ============================================================

// [RF-AUTH-03] | CA-01 | DTO de lista de dispositivos; marca el dispositivo
// actual usando currentFingerprintHash y currentSessionId
function TrustedDeviceListDTO(
  devices: Parameters<typeof TrustedDeviceComponent.buildArray>[0],
  currentFingerprintHash: string | null = null,
  currentSessionId: string | null = null
) {
  const built = TrustedDeviceComponent.buildArray(devices, currentFingerprintHash, currentSessionId);
  return {
    devices: built,
    total: built.length
  };
}

function TrustedDeviceUpdateDTO(device: Pick<TrustedDevice, 'userTrustedDeviceId' | 'deviceName' | 'status' | 'updatedAt'>) {
  return {
    userTrustedDeviceId: device.userTrustedDeviceId,
    deviceName: device.deviceName,
    status: device.status,
    updatedAt: device.updatedAt
  };
}

export default {
  LoginResponseDTO,
  PolicyUpdateRequiredDTO,
  DeviceApprovalRequiredDTO,
  MFARequiredResponseDTO,
  RefreshTokenResponseDTO,
  TrustedDeviceListDTO,
  TrustedDeviceUpdateDTO
};


/** Resultado de cerrar una sesión propia. */
export interface SessionClosed {
  sessionId: string;
  status: 'closed';
}

/** Resultado de cerrar las demás sesiones. */
export interface OtherSessionsClosed {
  closedCount: number;
}
