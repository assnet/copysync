/**
 * Limite de identificadores de afiliado vinculados ao tenant (etiquetas do Mercado Livre, principal incluída;
 * chave `mercado_livre_affiliate_tags`). Diferente das demais chaves numéricas, aqui ausente/`null` **não** é
 * ilimitado: tenant sem plano reconhecido vale 1. Valor fora de inteiro ≥ 1 também vale 1.
 * Fonte única: todo ponto que lê o limite passa por aqui.
 */
export const DEFAULT_IDENTIFIER_LIMIT = 1;

export function identifierLimitOf(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : DEFAULT_IDENTIFIER_LIMIT;
}
