import { describe, expect, it } from 'vitest';
import { billingWebhookBlockReason } from './billingWebhookGuard';

const prod = { BILLING_ENABLED: true, NODE_ENV: 'production' };

describe('billingWebhookBlockReason', () => {
  it('produção com e-mail noop ou hub sem credenciais não registra o webhook', () => {
    expect(billingWebhookBlockReason({ ...prod, EMAIL_SENDER: 'noop' })).toMatch(/EMAIL_SENDER=noop/);
    expect(billingWebhookBlockReason({ ...prod, EMAIL_SENDER: 'noop', HUB_EMAIL_CONFIGURED: true })).toMatch(/EMAIL_SENDER=noop/);
    expect(billingWebhookBlockReason({ ...prod, EMAIL_SENDER: 'hub' })).toMatch(/EMAIL_SENDER=hub sem HUB_API_URL/);
    expect(billingWebhookBlockReason({ ...prod, EMAIL_SENDER: 'hub', HUB_EMAIL_CONFIGURED: false })).toMatch(/EMAIL_SENDER=hub/);
  });

  it('produção com hub configurado ou SMTP, desenvolvimento ou billing desligado não bloqueia', () => {
    expect(billingWebhookBlockReason({ ...prod, EMAIL_SENDER: 'hub', HUB_EMAIL_CONFIGURED: true })).toBeNull();
    expect(billingWebhookBlockReason({ ...prod, EMAIL_SENDER: 'smtp' })).toBeNull();
    expect(billingWebhookBlockReason({ BILLING_ENABLED: true, NODE_ENV: 'development', EMAIL_SENDER: 'noop' })).toBeNull();
    expect(billingWebhookBlockReason({ BILLING_ENABLED: false, NODE_ENV: 'production', EMAIL_SENDER: 'noop' })).toBeNull();
  });
});
