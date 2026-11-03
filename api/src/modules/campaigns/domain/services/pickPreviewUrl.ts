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
 * `affiliateUrl` se ele está no texto como link inteiro (não basta ser prefixo de outro); senão o
 * primeiro link http(s) do texto, que no monitoramento é o primeiro reescrito e no gerador é o link
 * que o operador deixou. Sem link → null: a oferta sai como texto puro.
 */
export function pickPreviewUrl(text: string, affiliateUrl: string | null | undefined): string | null {
  const links = [...text.matchAll(URL_PATTERN)].map((m) => m[0].replace(TRAILING, '')).filter(Boolean);
  const affiliate = affiliateUrl?.trim();
  if (affiliate && links.includes(affiliate)) return affiliate;
  return links[0] ?? null;
}
