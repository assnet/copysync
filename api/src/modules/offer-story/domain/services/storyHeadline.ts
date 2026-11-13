import { OFFER_STORY_HEADLINE_MAX } from '../offerStoryRules';

/** Aspas retas/curvas/angulares, crase e marcação de ênfase que a IA às vezes devolve. */
const QUOTES = /["'`´“”‘’«»„*]/g;
/** Emoji e pictogramas, com seletor de variação e ZWJ que sobram entre eles. */
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}]/gu;
/** "R$" ou número com vírgula decimal (199,90): título com preço pode mentir na arte. */
const PRICE = /R\$|\d+,\d/i;
/** Percentual ("80%", "80 por cento"): desconto na arte só vem do cálculo De→Por, nunca da IA. */
const PERCENT = /%|\bpor\s*cento\b/i;
const NUMBERS = /\d+(?:[.,]\d+)*/g;
/** Pontuação que não deve terminar o título depois do corte. */
const TRAILING = /[\s,;:.\-–—/|]+$/u;

/**
 * Título curto do story (resposta da IA): tira aspas, emoji e quebras, colapsa espaços e corta em
 * `OFFER_STORY_HEADLINE_MAX` na última palavra inteira. `null` = inválido (vazio, com preço, com
 * percentual ou com número que não está em `sourceTitle`) e quem chama usa o título original.
 * Número de modelo ("800W", "S23") passa porque vem do título do produto; número novo é inventado.
 */
export function sanitizeStoryHeadline(raw: string | null | undefined, sourceTitle?: string): string | null {
  const text = (raw ?? '')
    .replace(QUOTES, '')
    .replace(EMOJI, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || PRICE.test(text) || PERCENT.test(text)) return null;
  if (sourceTitle !== undefined) {
    const known = new Set(sourceTitle.match(NUMBERS) ?? []);
    if ((text.match(NUMBERS) ?? []).some((n) => !known.has(n))) return null;
  }
  if (text.length <= OFFER_STORY_HEADLINE_MAX) return text;
  const cut = text.slice(0, OFFER_STORY_HEADLINE_MAX + 1);
  const space = cut.lastIndexOf(' ');
  // Palavra única gigante: corte seco; senão para na última palavra inteira
  const head = space > OFFER_STORY_HEADLINE_MAX / 2 ? cut.slice(0, space) : cut.slice(0, OFFER_STORY_HEADLINE_MAX);
  return head.replace(TRAILING, '') || null;
}
