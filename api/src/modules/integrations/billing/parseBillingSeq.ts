/** Teto do BIGINT do Postgres (`Tenant.lastBillingEventSeq`, `BillingEventReceipt.seq`). */
const PG_BIGINT_MAX = 9_223_372_036_854_775_807n;

/**
 * `seq` do evento da central (autoincrement BigInt) → bigint sem perda de precisão.
 * Aceita número JSON inteiro seguro (acima de 2^53 o JSON.parse já arredondou: rejeitado)
 * ou string só de dígitos até o teto do BIGINT. Qualquer outra coisa → null (400 no webhook).
 */
export function parseBillingSeq(value: unknown): bigint | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value === 'string' && /^\d{1,19}$/.test(value)) {
    const seq = BigInt(value);
    return seq <= PG_BIGINT_MAX ? seq : null;
  }
  return null;
}
