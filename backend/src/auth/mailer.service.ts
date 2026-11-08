import { Injectable, Logger } from '@nestjs/common';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Development mailer: logs messages and keeps them in memory (tests read `outbox`).
 * Production must swap this provider for a real transport (SES/SMTP) — see docs/PROGRESS.md.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger('Mailer');
  readonly outbox: OutgoingMail[] = [];

  async send(mail: OutgoingMail): Promise<void> {
    this.outbox.push(mail);
    if (process.env.NODE_ENV !== 'test') this.logger.log(`To ${mail.to}: ${mail.subject}\n${mail.text}`);
  }
}
