// tests/unit/modules/client/notification/webhook/services/email-bounce-webhook.service.test.ts
//
// EmailBounceWebhookService — ingesta del feed SNS de rebotes de SES. Probamos el pipeline de
// process(): parseo del envelope, verificación de firma SNS, gate del TopicArn, confirmación de
// suscripción, ramas de tipo de mensaje y, para Notification, el filtro de rebote PERMANENTE que
// acumula supresiones. Mockeamos el servicio de supresión, las utils de firma SNS, logger y
// constants; AppError es autocontenido (sin process.exit) y se usa real.

jest.mock('./email-suppression.service', () => ({
  registerHardBounce: jest.fn()
}));

jest.mock('../../../shared/infrastructure/security/sns-signature.util', () => ({
  verifySnsSignature: jest.fn(),
  confirmSnsSubscription: jest.fn()
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

jest.mock('../../../shared/infrastructure/config', () => ({
  notifications: { sns: { bounceTopicArn: 'arn:aws:sns:us-east-1:1:bounces' } }
}));

import { mocked, fixture } from 'tests/helpers/mock';
import emailSuppressionServiceModule from './email-suppression.service';
const emailSuppressionService = mocked(emailSuppressionServiceModule);
import snsSignatureUtilModule from '../../../shared/infrastructure/security/sns-signature.util';
const { verifySnsSignature, confirmSnsSubscription } = mocked(snsSignatureUtilModule);
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;
import service from './email-bounce-webhook.service';

const TOPIC = 'arn:aws:sns:us-east-1:1:bounces';

// Construye el envelope SNS de una Notification con un rebote permanente listo para procesar.
function permanentBounceEnvelope(recipients = [{ emailAddress: 'a@x.com' }]) {
  return {
    Type: 'Notification',
    TopicArn: TOPIC,
    Message: JSON.stringify({
      notificationType: 'Bounce',
      bounce: {
        bounceType: 'Permanent',
        bounceSubType: 'General',
        feedbackId: 'fb-1',
        bouncedRecipients: recipients
      }
    })
  };
}

describe('EmailBounceWebhookService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifySnsSignature.mockResolvedValue(true);
    confirmSnsSubscription.mockResolvedValue(undefined);
    emailSuppressionService.registerHardBounce.mockResolvedValue({ suppressed: true });
  });

  describe('_parse (vía process)', () => {
    it('acepta un objeto ya parseado sin volver a parsear', async () => {
      const result = await service.process({ Type: 'Otro', TopicArn: TOPIC });
      expect(result).toEqual({ type: 'Otro', processed: 0, suppressed: 0 });
    });

    it('lanza badRequest si el cuerpo string no es JSON válido', async () => {
      await expect(service.process('{no-json')).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('verificación de firma', () => {
    it('lanza unauthorized si la firma SNS es inválida', async () => {
      verifySnsSignature.mockResolvedValue(false);
      await expect(service.process({ Type: 'Notification', TopicArn: TOPIC })).rejects.toMatchObject({
        statusCode: 401
      });
    });
  });

  describe('gate de TopicArn', () => {
    it('lanza unauthorized si el TopicArn no coincide con el esperado', async () => {
      await expect(service.process({ Type: 'Notification', TopicArn: 'arn:otro' })).rejects.toMatchObject({
        statusCode: 401
      });
    });
  });

  describe('confirmación de suscripción', () => {
    it('confirma SubscriptionConfirmation, audita y responde confirmed', async () => {
      const result = await service.process({ Type: 'SubscriptionConfirmation', TopicArn: TOPIC });

      expect(confirmSnsSubscription).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('EMAIL_BOUNCE_SUBSCRIPTION_CONFIRMED', expect.objectContaining({ actorId: 'system', details: expect.objectContaining({ topicArn: TOPIC }) })
      );
      expect(result).toEqual({ type: 'SubscriptionConfirmation', confirmed: true, processed: 0, suppressed: 0 });
    });

    it('también confirma UnsubscribeConfirmation', async () => {
      const result = await service.process({ Type: 'UnsubscribeConfirmation', TopicArn: TOPIC });
      expect(confirmSnsSubscription).toHaveBeenCalled();
      expect(result).toMatchObject({ confirmed: true });
    });
  });

  describe('tipo de mensaje desconocido', () => {
    it('ignora tipos que no son Notification/Subscription y responde processed 0', async () => {
      const result = await service.process({ Type: 'Delivery', TopicArn: TOPIC });
      expect(result).toEqual({ type: 'Delivery', processed: 0, suppressed: 0 });
      expect(emailSuppressionService.registerHardBounce).not.toHaveBeenCalled();
    });
  });

  describe('_handleNotification', () => {
    it('lanza badRequest si el campo Message no es JSON válido', async () => {
      await expect(service.process({ Type: 'Notification', TopicArn: TOPIC, Message: 'no-json' })).rejects.toMatchObject(
        { statusCode: 400 }
      );
    });

    it('ignora un rebote NO permanente sin registrar supresiones', async () => {
      const envelope = {
        Type: 'Notification',
        TopicArn: TOPIC,
        Message: JSON.stringify({ notificationType: 'Bounce', bounce: { bounceType: 'Transient' } })
      };
      const result = await service.process(envelope);
      expect(emailSuppressionService.registerHardBounce).not.toHaveBeenCalled();
      expect(result).toEqual({ type: 'Notification', processed: 0, suppressed: 0 });
    });

    it('ignora un evento que no es Bounce', async () => {
      const envelope = {
        Type: 'Notification',
        TopicArn: TOPIC,
        Message: JSON.stringify({ eventType: 'Complaint' })
      };
      const result = await service.process(envelope);
      expect(result).toEqual({ type: 'Notification', processed: 0, suppressed: 0 });
    });

    it('registra hard bounce por cada destinatario y cuenta las supresiones', async () => {
      const envelope = permanentBounceEnvelope([{ emailAddress: 'a@x.com' }, { emailAddress: 'b@x.com' }]);

      const result = await service.process(envelope);

      expect(emailSuppressionService.registerHardBounce).toHaveBeenCalledTimes(2);
      expect(emailSuppressionService.registerHardBounce).toHaveBeenCalledWith({
        email: 'a@x.com',
        errorCode: 'General'
      });
      expect(logAudit).toHaveBeenCalledWith('EMAIL_BOUNCE_WEBHOOK_RECEIVED', expect.objectContaining({ actorId: 'system', details: expect.objectContaining({ recipients: 2, suppressed: 2, bounceSubType: 'General', feedbackId: 'fb-1' }) })
      );
      expect(result).toEqual({ type: 'Notification', processed: 2, suppressed: 2 });
    });

    it('salta destinatarios sin emailAddress y no los cuenta como procesados en supresión', async () => {
      const envelope = permanentBounceEnvelope(fixture([{ emailAddress: null }, { emailAddress: 'b@x.com' }]));

      const result = await service.process(envelope);

      expect(emailSuppressionService.registerHardBounce).toHaveBeenCalledTimes(1);
      // processed cuenta el total de bouncedRecipients (2), suppressed solo los realmente suprimidos (1).
      expect(result).toEqual({ type: 'Notification', processed: 2, suppressed: 1 });
    });

    it('no incrementa suppressed cuando el servicio de supresión no suprime', async () => {
      emailSuppressionService.registerHardBounce.mockResolvedValue({ suppressed: false });
      const result = await service.process(permanentBounceEnvelope([{ emailAddress: 'a@x.com' }]));
      expect(result).toEqual({ type: 'Notification', processed: 1, suppressed: 0 });
    });

    it('usa "Permanent" como errorCode por defecto si falta bounceSubType', async () => {
      const envelope = {
        Type: 'Notification',
        TopicArn: TOPIC,
        Message: JSON.stringify({
          notificationType: 'Bounce',
          bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'a@x.com' }] }
        })
      };
      await service.process(envelope);
      expect(emailSuppressionService.registerHardBounce).toHaveBeenCalledWith({
        email: 'a@x.com',
        errorCode: 'Permanent'
      });
    });
  });
});
