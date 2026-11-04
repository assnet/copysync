/**
 * Converte a formatação do WhatsApp (`*negrito*`, `_itálico_`, `~riscado~`, `` `mono` ``,
 * ```` ```bloco``` ````) para o HTML que o Telegram aceita com `parseMode: 'html'`.
 *
 * Função pura. O texto das ofertas (`renderOfferText`, prompt de IA, monitoramento) é escrito no
 * formato do WhatsApp; sem conversão o Telegram mostraria os asteriscos. Regras:
 * - Links ficam intactos: são separados antes da marcação, então `_`/`*` dentro de URL de
 *   afiliado nunca viram itálico/negrito. Marca colada no fim do link (`*https://x.com*`) volta
 *   para o texto e formata o link inteiro.
 * - Marca só abre/fecha fora de palavra (como no WhatsApp): `snake_case`, `2*3*4` ficam como estão.
 * - `&`, `<`, `>` são escapados; código não recebe outra formatação.
 */
const CTRL = '\u0001';
// Link para no placeholder (CTRL): sem isso URL colada a `código` engoliria o slot e o controle vazaria
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>\u0001]+|(?<![\p{L}\p{N}_@.-])(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>\u0001]*/giu;
const TRAILING_PUNCT = /[.,!?;:'")\]}]+$/;
const MARKERS = new Set(['*', '_', '~']);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** `*x*`, `_x_`, `~x~` fora de palavra, numa linha, sem espaço colado na marca. */
function markRe(m: string): RegExp {
  const e = m === '*' ? '\\*' : m; // modo `u`: só `*` aceita escape
  return new RegExp(`(?<![\\p{L}\\p{N}${e}])${e}(?=[^\\s${e}])([^${e}\\n]*?[^\\s${e}])${e}(?![\\p{L}\\p{N}${e}])`, 'gu');
}
const BOLD = markRe('*');
const ITALIC = markRe('_');
const STRIKE = markRe('~');

export function whatsappToTelegramHtml(text: string): string {
  const slots: string[] = [];
  const hold = (html: string) => `${CTRL}${slots.push(html) - 1}${CTRL}`;

  let out = text.replace(new RegExp(CTRL, 'g'), '');
  // 1. Código: conteúdo literal
  out = out.replace(/```([\s\S]+?)```/g, (_, code: string) =>
    hold(code.includes('\n') ? `<pre>${escapeHtml(code)}</pre>` : `<code>${escapeHtml(code)}</code>`));
  out = out.replace(/`([^`\n]+)`/g, (_, code: string) => hold(`<code>${escapeHtml(code)}</code>`));
  // 2. Links: protegidos da marcação; pontuação e marca de fechamento coladas voltam ao texto
  out = out.replace(URL_RE, (match: string, offset: number, whole: string) => {
    let url = match;
    let rest = '';
    const punct = TRAILING_PUNCT.exec(url);
    if (punct) { rest = punct[0]; url = url.slice(0, -rest.length); }
    const before = whole[offset - 1];
    if (before && MARKERS.has(before) && url.endsWith(before) && url.length > 1) {
      url = url.slice(0, -1);
      rest = before + rest;
    }
    return hold(escapeHtml(url)) + rest;
  });
  // 3. Escape do resto e marcação
  out = escapeHtml(out)
    .replace(BOLD, '<b>$1</b>')
    .replace(ITALIC, '<i>$1</i>')
    .replace(STRIKE, '<s>$1</s>');
  return out.replace(new RegExp(`${CTRL}(\\d+)${CTRL}`, 'g'), (_, i: string) => slots[Number(i)] ?? '');
}
