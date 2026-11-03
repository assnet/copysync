/**
 * Webhook do billing em produção sem envio de e-mail real: o provisionamento criaria contas cujo
 * convite de primeiro acesso nunca chega. Fail-closed — a rota não sobe e o hub reenvia depois.
 * `hub` ainda cai no noop (EmailSenderFactory), então bloqueia igual.
 */
export function billingWebhookBlockReason(cfg: {
  BILLING_ENABLED: boolean;
  NODE_ENV: string;
  EMAIL_SENDER: string;
}): string | null {
  if (!cfg.BILLING_ENABLED || cfg.NODE_ENV !== 'production') return null;
  if (cfg.EMAIL_SENDER === 'noop' || cfg.EMAIL_SENDER === 'hub') {
    return `EMAIL_SENDER=${cfg.EMAIL_SENDER} em produção: webhook do billing não registrado (convites não seriam entregues); o hub reenvia os eventos quando o envio de e-mail estiver configurado`;
  }
  return null;
}
