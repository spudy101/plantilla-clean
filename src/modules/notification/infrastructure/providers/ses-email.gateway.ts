// Adaptador AWS SES del puerto EmailGateway. Sin adjuntos, SendEmail; con adjuntos válidos (metadata.attachments),
// un MIME multipart/mixed por SendRawEmail. Cada llamada pasa por callProvider (timeout, circuit breaker, traza).
import { SESClient, SendEmailCommand, SendRawEmailCommand } from '@aws-sdk/client-ses';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
import constantsModule from '../../../../shared/infrastructure/config';
import { AWS_CLIENT_OPTIONS, callProvider } from '../../../../shared/infrastructure/providers/provider-call.util';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import type { EmailGateway, OutgoingEmail } from '../../application/ports/channel-gateways.port';

const { logger } = loggerUtilModule;
const { notifications, aws } = constantsModule;
const { errorMessage } = errorMessageModule;

/** Límite del mensaje raw de SES (SendRawEmail): 10 MB incluyendo adjuntos en base64. */
const SES_RAW_MAX_BYTES = 10 * 1024 * 1024;

/** Adjunto ya normalizado (contenido en base64). */
export interface Attachment {
  filename: string;
  contentType: string;
  base64: string;
}

/**
 * Cada adjunto puede venir como { filename, contentType, content }, con content un Buffer o un string ya en
 * base64 (lo habitual: la metadata llega como JSON). Los inválidos (sin filename o sin contenido) se descartan.
 */
export function resolveAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }
  return raw.map(normalizeAttachment).filter((a): a is Attachment => a !== null);
}

function normalizeAttachment(input: unknown): Attachment | null {
  const attachment = input as { filename?: unknown; contentType?: unknown; content?: unknown } | null;
  if (!attachment || typeof attachment.filename !== 'string' || !attachment.filename) {
    return null;
  }
  let base64: string | null = null;
  if (Buffer.isBuffer(attachment.content)) {
    base64 = attachment.content.toString('base64');
  } else if (typeof attachment.content === 'string' && attachment.content.length > 0) {
    base64 = attachment.content;
  }
  if (!base64) {
    logger.warn('Adjunto de email ignorado: sin contenido válido', { filename: attachment.filename });
    return null;
  }
  return {
    filename: attachment.filename,
    contentType: typeof attachment.contentType === 'string' && attachment.contentType ? attachment.contentType : 'application/octet-stream',
    base64
  };
}

/** El MIME multipart/mixed (cuerpo HTML + N adjuntos), todo en base64 para transportar UTF-8 y binarios. */
export function buildMimeWithAttachments(to: string, subject: string, html: string, attachments: readonly Attachment[]): string {
  const boundary = `BaseProjectMIME${Date.now()}`;
  const parts = [
    `From: ${notifications.ses.fromEmail}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf-8').toString('base64'),
    ''
  ];
  for (const attachment of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      '',
      attachment.base64,
      ''
    );
  }
  parts.push(`--${boundary}--`);
  return parts.join('\r\n');
}

export class SesEmailGateway implements EmailGateway {
  private client: SESClient | null = null;

  /** Se crea al primer uso: al cargar el módulo la configuración de AWS puede no estar lista (tests). */
  private get ses(): SESClient {
    if (!this.client) {
      this.client = new SESClient({
        ...AWS_CLIENT_OPTIONS,
        region: aws.region,
        credentials: { accessKeyId: aws.accessKeyId, secretAccessKey: aws.secretAccessKey }
      });
    }
    return this.client;
  }

  send({ to, subject, html, attachments, notificationId = null }: OutgoingEmail): Promise<{ messageId?: string | undefined }> {
    const resolved = resolveAttachments(attachments);
    return resolved.length > 0 ? this.sendRaw(to, subject, html, resolved, notificationId) : this.sendSimple(to, subject, html, notificationId);
  }

  private async sendSimple(to: string, subject: string, html: string, notificationId: string | null) {
    try {
      const command = new SendEmailCommand({
        Source: notifications.ses.fromEmail,
        Destination: { ToAddresses: [to] },
        Message: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Html: { Data: html, Charset: 'UTF-8' } } }
      });
      const response = await callProvider({ product: 'ses', endpoint: 'SES:SendEmailCommand', notificationId }, abortSignal =>
        this.ses.send(command, { abortSignal })
      );
      logger.info('Email enviado exitosamente', { destinatario: to, messageId: response.MessageId });
      return { messageId: response.MessageId };
    } catch (error) {
      logger.warn('Error al enviar email', { error: errorMessage(error), destinatario: to, asunto: subject });
      throw error;
    }
  }

  private async sendRaw(to: string, subject: string, html: string, attachments: Attachment[], notificationId: string | null) {
    const raw = buildMimeWithAttachments(to, subject, html, attachments);
    if (Buffer.byteLength(raw) > SES_RAW_MAX_BYTES) {
      throw new Error('El email con adjuntos supera el límite de 10 MB de SES');
    }
    const command = new SendRawEmailCommand({ RawMessage: { Data: Buffer.from(raw) } });
    try {
      const response = await callProvider({ product: 'ses', endpoint: 'SES:SendRawEmailCommand', notificationId }, abortSignal =>
        this.ses.send(command, { abortSignal })
      );
      logger.info('Email con adjuntos enviado exitosamente', { destinatario: to, adjuntos: attachments.length, messageId: response.MessageId });
      return { messageId: response.MessageId };
    } catch (error) {
      logger.warn('Error al enviar email con adjuntos', { error: errorMessage(error), destinatario: to });
      throw error;
    }
  }
}
