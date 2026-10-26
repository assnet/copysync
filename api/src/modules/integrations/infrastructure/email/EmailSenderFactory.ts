import { logger } from '../../../../shared/logger/logger';
import type { IEmailSender } from '../../domain/contracts/IEmailSender';
import { NoopEmailSender } from './NoopEmailSender';
import { SmtpEmailSender } from './SmtpEmailSender';

const log = logger.child({ module: 'EmailSenderFactory' });

export type EmailSenderMode = 'noop' | 'smtp' | 'hub';

export function createEmailSender(opts: {
  mode: EmailSenderMode;
  smtpUrl?: string;
  from?: string;
}): IEmailSender {
  switch (opts.mode) {
    case 'smtp': {
      if (!opts.smtpUrl || !opts.from) {
        throw new Error('EMAIL_SENDER=smtp requires EMAIL_SMTP_URL and EMAIL_FROM');
      }
      log.info('Email sender: SMTP');
      return new SmtpEmailSender(opts.smtpUrl, opts.from);
    }
    case 'hub':
      throw new Error('EMAIL_SENDER=hub not implemented yet (planned for M2)');
    case 'noop':
    default:
      log.warn('Email sender: Noop (emails will not be delivered)');
      return new NoopEmailSender();
  }
}
