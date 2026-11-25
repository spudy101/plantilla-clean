// SMS transaccionales y OTP: arma el E.164 con el prefijo del país y lo envía por el proveedor (que deja cada
// intento en su bitácora y nunca lanza por un fallo de envío).
import { toE164 } from '../../domain/phone-number';
import type { OutgoingSms, SmsGateway, SmsResult } from '../ports/channel-gateways.port';
import type { PhonePrefixes } from '../ports/recipient-directory.port';

export class SmsSender {
  constructor(
    private readonly gateway: SmsGateway,
    private readonly prefixes: PhonePrefixes
  ) {}

  /** El número local + el prefijo de su país. Si ya viene en E.164, o no hay prefijo resoluble, tal cual. */
  async resolveE164(localNumber: string, prefixId: string | null = null): Promise<string> {
    if (!localNumber || localNumber.startsWith('+') || !prefixId) {
      return localNumber;
    }
    return toE164(localNumber, await this.prefixes.prefixOf(prefixId));
  }

  send(sms: OutgoingSms): Promise<SmsResult> {
    return this.gateway.send({ ...sms, userId: sms.userId ?? null });
  }
}
