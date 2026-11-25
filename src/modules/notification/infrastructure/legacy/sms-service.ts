// @deprecated TRANSITORIO: los SMS de iam (MFA y challenge de login) por el index.ts, con el SmsSender que dejó
// armado notification.module.ts.
import type { OutgoingSms, SmsResult } from '../../application/ports/channel-gateways.port';
import { legacyBindings } from './legacy-bindings';

export default {
  /** SMS OTP (propósito por defecto 'otp_verification'). Nunca lanza por un fallo de envío. */
  enviarSmsOtp({
    phoneNumber,
    message,
    userId = null,
    purpose = 'otp_verification'
  }: Omit<OutgoingSms, 'purpose'> & { purpose?: string }): Promise<SmsResult> {
    return legacyBindings().sms.send({ phoneNumber, message, userId, purpose });
  },

  /** El número local + el prefijo de su país (E.164). */
  resolveE164(localNumber: string, prefixId: string | null = null): Promise<string> {
    return legacyBindings().sms.resolveE164(localNumber, prefixId);
  }
};
