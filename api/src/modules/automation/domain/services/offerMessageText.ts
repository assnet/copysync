/**
 * Links em texto de grupo: com protocolo, ou QUALQUER `dominio.tld/caminho` sem protocolo
 * (amzn.to/…, www.amazon.com.br/…, bit.ly/…), inteiro, com subdomínios. Encurtador de terceiro
 * que não for marketplace é removido no processamento: nada do concorrente passa.
 */
// Antes do protocolo/domínio só não pode letra/dígito (`_https://…_` e `_amzn.to/x_`, itálico do
// WhatsApp, casam inteiros; `\b` falhava depois de `_` e duplicava o protocolo na troca)
const URL_PATTERN = /(?<![a-z0-9])https?:\/\/[^\s<>"'`]+|(?<![a-z0-9@.-])(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"'`]*/gi;

/** Pontuação/markdown do WhatsApp colada no fim do link não faz parte dele. */
const TRAILING = /[)\].,!?;:*_~]+$/;

export interface FoundUrl {
  /** Como aparece no texto (sem a pontuação final). */
  raw: string;
  /** Com protocolo, pronto para `new URL`. */
  href: string;
}

const toHref = (raw: string) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);

/** Links do texto, na ordem, sem repetição (com e sem protocolo contam como o mesmo). */
export function extractUrls(text: string): FoundUrl[] {
  const out: FoundUrl[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_PATTERN)) {
    const raw = m[0].replace(TRAILING, '');
    const href = toHref(raw);
    if (!raw || seen.has(href)) continue;
    seen.add(href);
    out.push({ raw, href });
  }
  return out;
}

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
export function previewText(text: string, max = 280): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}
