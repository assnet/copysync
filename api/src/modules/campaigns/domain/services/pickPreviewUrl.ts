/**
 * Link com protocolo no texto. Antes dele só não pode letra/dígito: `🛒https://…`, `_https://…_`
 * (itálico do WhatsApp) e `(https://…)` casam. Mesmo critério de `offerMessageText.extractUrls`.
 */
const URL_PATTERN = /(?<![a-z0-9])https?:\/\/[^\s<>"'`]+/gi;

/** Pontuação/markdown do WhatsApp colada no fim do link não faz parte dele. */
const TRAILING = /[)\].,!?;:*_~]+$/;

/**
 * Link da prévia da oferta, exatamente como aparece no texto (vira o `matchedText` do envio).
 *
 * Só o `affiliateUrl`, e só se ele está no texto como link inteiro (não basta ser prefixo de outro).
 * Fora isso → null: a oferta sai como texto puro. Nunca usa outro link do texto, para a prévia não
 * divulgar link que não é do tenant (TLINK-22).
 */
export function pickPreviewUrl(text: string, affiliateUrl: string | null | undefined): string | null {
  const affiliate = affiliateUrl?.trim();
  if (!affiliate) return null;
  const links = [...text.matchAll(URL_PATTERN)].map((m) => m[0].replace(TRAILING, ''));
  return links.includes(affiliate) ? affiliate : null;
}
