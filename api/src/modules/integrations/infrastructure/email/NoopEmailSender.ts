import { logger } from '../../../../shared/logger/logger';
import type { IEmailSender, SendEmailInput, SendEmailResult } from '../../domain/contracts/IEmailSender';

const log = logger.child({ module: 'NoopEmailSender' });

export class NoopEmailSender implements IEmailSender {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    log.warn({ to: input.to, template: input.template }, 'Email not sent (no provider configured)');
    return { sent: false };
  }
}
