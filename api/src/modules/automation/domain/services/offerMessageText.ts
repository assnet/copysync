import { extractUrls, toHref, TRAILING, URL_PATTERN } from '../../../campaigns/domain/services/extractUrls';

// Extração de link vive em `campaigns/domain/services/extractUrls.ts` (também usada na edição da oferta)
export { extractUrls };
export type { FoundUrl } from '../../../campaigns/domain/services/extractUrls';

/**
 * Troca links do texto, chaveado por `href` (toda ocorrência, com ou sem protocolo):
 * `string` = novo link; `null` = remove. Linha que só tinha links
 * removidos (ex.: "Entre no grupo: chat.whatsapp.com/…") sai inteira, para não divulgar o
 * concorrente. Links fora do mapa ficam como estão.
 */
export function rewriteOfferLinks(text: string, replacements: ReadonlyMap<string, string | null>): string {
  const lines = text.split('\n').flatMap((line) => {
    let removed = false;
    let kept = false;
    const next = line.replace(URL_PATTERN, (match) => {
      const raw = match.replace(TRAILING, '');
      const tail = match.slice(raw.length);
      const href = toHref(raw);
      if (!replacements.has(href)) {
        kept = true;
        return match;
      }
      const to = replacements.get(href);
      if (to == null) {
        removed = true;
        return tail;
      }
      kept = true;
      return to + tail;
    });
    return removed && !kept ? [] : [next.replace(/[ \t]+$/, '')];
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const COUPON = /(?:cupom|cupon|coupon|c[oó]digo|code)\s*(?:de\s+desconto)?\s*[:：\-–—]?\s*[*_~]*([A-Za-z0-9][A-Za-z0-9_-]{2,39})/i;
/** Palavras que vêm depois de "cupom" e não são código. */
const NOT_A_CODE = new Set(['DE', 'DO', 'DA', 'NO', 'NA', 'PARA', 'COM', 'SEM', 'APLICADO', 'DESCONTO', 'VALIDO', 'VÁLIDO', 'EXCLUSIVO', 'ABAIXO']);

/** Código de cupom citado no texto (maiúsculo), ou null. */
export function detectCoupon(text: string): string | null {
  const m = COUPON.exec(text);
  if (!m) return null;
  const code = m[1]!.toUpperCase();
  if (NOT_A_CODE.has(code) || !/[A-Z]/.test(code) && !/\d{3,}/.test(code)) return null;
  return code;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Lista vazia = aceita tudo; senão, ao menos uma palavra (sem acento, sem caixa) no texto. */
export function matchesKeywords(text: string, keywords: readonly string[]): boolean {
  const wanted = keywords.map((k) => fold(k.trim())).filter(Boolean);
  if (wanted.length === 0) return true;
  const hay = fold(text);
  return wanted.some((k) => hay.includes(k));
}

/** Prévia segura para lista (sem quebrar emoji/surrogate no corte). */
/** Sobra algo além de links? Captura só com link(s) não tem texto de oferta para repassar. */
export function hasTextBeyondLinks(text: string): boolean {
  let rest = text;
  for (const u of extractUrls(text)) rest = rest.split(u.raw).join(' ');
  return rest.replace(/[\s\p{P}\p{S}]+/gu, '').length > 0;
}

export function previewText(text: string, max = 280): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}
