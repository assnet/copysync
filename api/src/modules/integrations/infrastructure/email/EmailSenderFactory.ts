import { env } from '../../../../shared/config/env';
import { logger } from '../../../../shared/logger/logger';
import type { IEmailSender } from '../../domain/contracts/IEmailSender';
import { HubEmailSender } from './HubEmailSender';
import { NoopEmailSender } from './NoopEmailSender';
import { SmtpEmailSender } from './SmtpEmailSender';

const log = logger.child({ module: 'EmailSenderFactory' });

export type EmailSenderMode = 'noop' | 'smtp' | 'hub';

export interface EmailSenderOptions {
  mode: EmailSenderMode;
  smtpUrl?: string;
  from?: string;
  hubUrl?: string;
  hubApplicationKey?: string;
  hubSecret?: string;
}

export function createEmailSender(opts: EmailSenderOptions): IEmailSender {
  switch (opts.mode) {
    case 'smtp': {
      if (!opts.smtpUrl || !opts.from) {
        throw new Error('EMAIL_SENDER=smtp requires EMAIL_SMTP_URL and EMAIL_FROM');
      }
      log.info('Email sender: SMTP');
      return new SmtpEmailSender(opts.smtpUrl, opts.from);
    }
    case 'hub':
      if (!opts.hubUrl || !opts.hubApplicationKey || !opts.hubSecret) {
        // Não lança: o provisionamento inteiro responderia 500. Em produção o guard do webhook já bloqueia.
        log.error('EMAIL_SENDER=hub requires HUB_API_URL, HUB_APPLICATION_KEY and HUB_M2M_SECRET; using noop');
        return new NoopEmailSender();
      }
      return new HubEmailSender({ hubUrl: opts.hubUrl, applicationKey: opts.hubApplicationKey, secret: opts.hubSecret });
    case 'noop':
    default:
      log.warn('Email sender: Noop (emails will not be delivered)');
      return new NoopEmailSender();
  }
}

/** Sender configurado pelo env (`EMAIL_SENDER` + credenciais do modo). */
export function createEmailSenderFromEnv(): IEmailSender {
  return createEmailSender({
    mode: env.EMAIL_SENDER,
    smtpUrl: env.EMAIL_SMTP_URL,
    from: env.EMAIL_FROM,
    hubUrl: env.HUB_API_URL,
    hubApplicationKey: env.HUB_APPLICATION_KEY,
    hubSecret: env.HUB_M2M_SECRET,
  });
}
