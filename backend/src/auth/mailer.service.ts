import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG, AppConfig } from '../config/env';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

const RETRY_DELAYS_MS = [1_000, 4_000];

/** "asha@example.com" → "a***@example.com", so logs never carry full addresses. */
const mask = (email: string) => email.replace(/^(.).*(@.*)$/, '$1***$2');

/**
 * Email delivery.
 * - Tests: messages are only kept in `outbox`.
 * - SMTP configured (SMTP_HOST etc., e.g. a Gmail app password): sent in the background with
 *   retries, so a slow or failing mail server never blocks or fails the request that triggered it.
 * - Development without SMTP: the message is logged so links can be opened locally.
 * - Production without SMTP: nothing is sent and only the subject is logged — never the body,
 *   which can contain one-time links.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger('Mailer');
  private readonly transport?: Transporter;
  readonly outbox: OutgoingMail[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const s = config.smtp;
    if (s && config.nodeEnv !== 'test') {
      this.transport = createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: s.password } : undefined });
    }
  }

  async send(mail: OutgoingMail): Promise<void> {
    this.outbox.push(mail);
    if (this.config.nodeEnv === 'test') return;
    if (this.transport) {
      void this.deliver(mail);
      return;
    }
    if (this.config.nodeEnv === 'production') {
      this.logger.warn(`Email delivery is not configured (SMTP_HOST unset): "${mail.subject}" to ${mask(mail.to)} was not sent.`);
    } else {
      this.logger.log(`To ${mail.to}: ${mail.subject}\n${mail.text}`);
    }
  }

  private async deliver(mail: OutgoingMail, attempt = 0): Promise<void> {
    try {
      await this.transport!.sendMail({ from: this.config.smtp!.from, to: mail.to, subject: mail.subject, text: mail.text });
      this.logger.log(`Sent "${mail.subject}" to ${mask(mail.to)}`);
    } catch (e: any) {
      if (attempt < RETRY_DELAYS_MS.length) {
        setTimeout(() => void this.deliver(mail, attempt + 1), RETRY_DELAYS_MS[attempt]);
        return;
      }
      this.logger.error(`Could not send "${mail.subject}" to ${mask(mail.to)} after ${attempt + 1} attempts: ${e?.code ?? e?.message ?? 'unknown error'}`);
    }
  }
}
