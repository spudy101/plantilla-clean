// Puertos de los proveedores de cada canal externo (email, push, SMS) y de la lectura de sus errores. Los
// implementa infrastructure/providers con AWS (SES, SNS). Los casos de uso deciden qué mandar y qué hacer con un
// fallo; el proveedor solo envía.
import type { Channel } from '../../domain/notification-type';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  /** metadata.attachments del envío, tal como vino (el proveedor descarta los inválidos). */
  attachments?: unknown;
  /** Para correlacionar la llamada al proveedor con la notificación. */
  notificationId?: string | null;
}

export interface EmailGateway {
  /** Lanza el error del proveedor si no se pudo enviar. */
  send(email: OutgoingEmail): Promise<{ messageId?: string | undefined }>;
}

export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface BulkPushResult {
  success: number;
  failed: number;
  /** Los que el proveedor reportó dados de baja, para desactivar su token. */
  disabledEndpoints: string[];
}

export interface PushGateway {
  /** A un dispositivo. Lanza el error del proveedor si falla. */
  sendToDevice(endpoint: string, message: PushMessage, notificationId?: string | null): Promise<void>;
  /** A muchos (envío masivo): nunca lanza, devuelve cuántos llegaron. */
  sendToMany(endpoints: readonly string[], message: PushMessage): Promise<BulkPushResult>;
  /** Da de alta (o actualiza) el dispositivo en el proveedor; devuelve su endpoint. */
  registerDevice(deviceToken: string, platform: string, userId: string): Promise<string | undefined>;
}

/** Los intentos de SMS (la ventana de una caída del proveedor la mide integration). */
export interface SmsAttemptLog {
  countFailedBetween(from: Date | null, to: Date): Promise<number>;
}

export interface OutgoingSms {
  /** E.164. */
  phoneNumber: string;
  message: string;
  userId?: string | null;
  /** Propósito, para trazabilidad (p. ej. 'notification', 'otp_verification'). */
  purpose: string;
}

export interface SmsResult {
  success: boolean;
  attemptId: string;
  error?: string;
  mock?: boolean;
  circuitOpen?: boolean;
  serviceUnavailable?: boolean;
}

export interface SmsGateway {
  /** Nunca lanza por un fallo del proveedor: lo devuelve en el resultado. */
  send(sms: OutgoingSms): Promise<SmsResult>;
}

/** Cómo leer el error de un proveedor: su código y si es definitivo. */
export interface ProviderErrorClassifier {
  /** El código del proveedor (p. ej. MessageRejected), o null si no trae. */
  codeOf(error: unknown): string | null;
  /** Rebote definitivo del canal: no tiene sentido reintentar. */
  isHardBounce(channel: Channel, code: string | null): boolean;
  /** El dispositivo push fue dado de baja. */
  isEndpointDisabled(code: string | null): boolean;
}

/** Tope por minuto de los envíos masivos a cada proveedor: pide lugar para `amount` envíos (espera si no hay). */
export interface SendRateLimiter {
  acquire(provider: 'push' | 'email', amount: number): Promise<void>;
}
