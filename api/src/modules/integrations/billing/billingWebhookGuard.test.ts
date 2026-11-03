import { describe, expect, it } from 'vitest';
import { billingWebhookBlockReason } from './billingWebhookGuard';

describe('billingWebhookBlockReason', () => {
  it('produção com e-mail noop ou hub não registra o webhook', () => {
    expect(billingWebhookBlockReason({ BILLING_ENABLED: true, NODE_ENV: 'production', EMAIL_SENDER: 'noop' })).toMatch(/EMAIL_SENDER=noop/);
    expect(billingWebhookBlockReason({ BILLING_ENABLED: true, NODE_ENV: 'production', EMAIL_SENDER: 'hub' })).toMatch(/EMAIL_SENDER=hub/);
  });

  it('produção com SMTP, desenvolvimento ou billing desligado não bloqueia', () => {
    expect(billingWebhookBlockReason({ BILLING_ENABLED: true, NODE_ENV: 'production', EMAIL_SENDER: 'smtp' })).toBeNull();
    expect(billingWebhookBlockReason({ BILLING_ENABLED: true, NODE_ENV: 'development', EMAIL_SENDER: 'noop' })).toBeNull();
    expect(billingWebhookBlockReason({ BILLING_ENABLED: false, NODE_ENV: 'production', EMAIL_SENDER: 'noop' })).toBeNull();
  });
});
