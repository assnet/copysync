/**
 * Links em texto de grupo: com protocolo, ou QUALQUER `dominio.tld/caminho` sem protocolo
 * (amzn.to/…, www.amazon.com.br/…, bit.ly/…), inteiro, com subdomínios. Encurtador de terceiro
 * que não for marketplace é removido no processamento: nada do concorrente passa.
 */
// Antes do protocolo/domínio só não pode letra/dígito (`_https://…_` e `_amzn.to/x_`, itálico do
// WhatsApp, casam inteiros; `\b` falhava depois de `_` e duplicava o protocolo na troca)
export const URL_PATTERN = /(?<![a-z0-9])https?:\/\/[^\s<>"'`]+|(?<![a-z0-9@.-])(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"'`]*/gi;

/** Pontuação/markdown do WhatsApp colada no fim do link não faz parte dele. */
export const TRAILING = /[)\].,!?;:*_~]+$/;

export interface FoundUrl {
  /** Como aparece no texto (sem a pontuação final). */
  raw: string;
  /** Com protocolo, pronto para `new URL`. */
  href: string;
}

export const toHref = (raw: string) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);

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
