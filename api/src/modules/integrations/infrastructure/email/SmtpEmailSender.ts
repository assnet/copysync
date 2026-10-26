import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { logger } from '../../../../shared/logger/logger';
import type { IEmailSender, SendEmailInput, SendEmailResult } from '../../domain/contracts/IEmailSender';

const log = logger.child({ module: 'SmtpEmailSender' });
const TIMEOUT_MS = 5_000;

export class SmtpEmailSender implements IEmailSender {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(smtpUrl: string, from: string) {
    this.from = from;
    this.transporter = nodemailer.createTransport(smtpUrl, {
      connectionTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    } as Record<string, unknown>);
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: input.template,
        text: JSON.stringify(input.data, null, 2),
      });
      return { sent: true };
    } catch (err) {
      log.error({ err, to: input.to, template: input.template }, 'Failed to send email via SMTP');
      return { sent: false };
    }
  }
}
