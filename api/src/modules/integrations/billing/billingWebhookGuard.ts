/**
 * Webhook do billing em produção sem envio de e-mail real: o provisionamento criaria contas cujo
 * convite de primeiro acesso nunca chega. Fail-closed — a rota não sobe e o hub reenvia depois.
 * `noop` sempre bloqueia; `hub` só passa com HUB_API_URL + HUB_APPLICATION_KEY + HUB_M2M_SECRET.
 */
export function billingWebhookBlockReason(cfg: {
  BILLING_ENABLED: boolean;
  NODE_ENV: string;
  EMAIL_SENDER: string;
  HUB_EMAIL_CONFIGURED?: boolean;
}): string | null {
  if (!cfg.BILLING_ENABLED || cfg.NODE_ENV !== 'production') return null;
  if (cfg.EMAIL_SENDER === 'noop' || (cfg.EMAIL_SENDER === 'hub' && !cfg.HUB_EMAIL_CONFIGURED)) {
    const detail = cfg.EMAIL_SENDER === 'hub' ? ' sem HUB_API_URL/HUB_APPLICATION_KEY/HUB_M2M_SECRET' : '';
    return `EMAIL_SENDER=${cfg.EMAIL_SENDER}${detail} em produção: webhook do billing não registrado (convites não seriam entregues); o hub reenvia os eventos quando o envio de e-mail estiver configurado`;
  }
  return null;
}
