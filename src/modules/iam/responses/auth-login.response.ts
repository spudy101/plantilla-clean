import { z } from '../../../shared/validation/z';
import { dateTime } from '../../../shared/validation/output';
import { TrustedDeviceSchema } from './auth-components.response';
import type { UserTrustedDevice } from '../../../shared/database/generated/prisma/client';
import type { UserProfileRow, UserWith } from '../repositories/user.repository';
import personModule from '../../person';
const { personComponentsDto: componentsPersonModule } = personModule;
const { UserComponent, PersonComponent, PersonContactComponent, PersonLocationComponent } = componentsPersonModule;
import componentsAuthModule from './auth-components.response';
const { TrustedDeviceComponent } = componentsAuthModule;

/**
 * ============================================================
 * AUTH LOGIN DTOs
 * ============================================================
 */

// ============================================================
// LOGIN
// ============================================================

/** Par de tokens emitido por SessionIssuerService. */
interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

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
  user: UserWith<'login'> | UserProfileRow;
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

function TrustedDeviceUpdateDTO(device: Pick<UserTrustedDevice, 'userTrustedDeviceId' | 'deviceName' | 'status' | 'updatedAt'>) {
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

// ── Esquemas de salida ──
const { UserSchema, PersonSchema, PersonContactSchema, PersonLocationSchema } = personModule.personSchemas;

export const AuthTokensSchema = z.object({
  accessToken: z.string().meta({ description: 'JWT de acceso (Bearer).' }),
  refreshToken: z.string(),
  expiresIn: z.number().int().meta({ example: 3600, description: 'Segundos de vigencia del access token.' })
});

export const LoginSchema = z.object({
  user: UserSchema.nullable(),
  deviceId: z.uuid().nullable().meta({ description: 'Dispositivo de confianza con el que se inició sesión.' }),
  person: PersonSchema.nullable().optional(),
  contact: PersonContactSchema.nullable().optional(),
  location: PersonLocationSchema.nullable().optional(),
  tokens: AuthTokensSchema.optional(),
  hmacSecret: z.string().optional().meta({ description: 'Secreto HMAC del dispositivo. Solo la primera vez que se registra.' })
});

export const PolicyUpdateRequiredSchema = z.object({
  requiresPolicyAcceptance: z.literal(true),
  policy: z.object({
    currentVersion: z.string().nullable(),
    newVersion: z.string().meta({ example: '2.0' }),
    documentUrl: z.string(),
    summary: z.string().nullable(),
    effectiveDate: dateTime().nullable()
  }),
  message: z.string()
});

export const DeviceApprovalRequiredSchema = z.object({
  requiresDeviceApproval: z.literal(true),
  deviceId: z.uuid(),
  message: z.string()
});

export const MfaRequiredSchema = z.object({
  requiresMFA: z.literal(true),
  challengeType: z.string().meta({ example: 'SOFTWARE_TOKEN_MFA' }),
  preferredMfaMethod: z.string().meta({ example: 'totp', description: 'none | totp | sms' }),
  username: z.string().nullable(),
  session: z.string().meta({ description: 'Sesión del desafío: se envía en verify-mfa.' })
});

export const TrustedDeviceListSchema = z.object({ devices: z.array(TrustedDeviceSchema), total: z.number().int() });

export const TrustedDeviceUpdateSchema = z.object({
  userTrustedDeviceId: z.uuid(),
  deviceName: z.string().nullable(),
  status: z.string().meta({ example: 'trusted' }),
  updatedAt: dateTime()
});

// Resultados armados en el service (sin función DTO)
export const SessionClosedSchema = z.object({ sessionId: z.uuid(), status: z.literal('closed') });
export type SessionClosed = z.infer<typeof SessionClosedSchema>;
export const OtherSessionsClosedSchema = z.object({
  closedCount: z.number().int().meta({ example: 2, description: 'Sesiones cerradas (todas menos la actual).' })
});
export type OtherSessionsClosed = z.infer<typeof OtherSessionsClosedSchema>;
