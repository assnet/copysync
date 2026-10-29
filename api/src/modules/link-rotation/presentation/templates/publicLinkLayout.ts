import { createHash } from 'node:crypto';
import { APP_NAME } from '../../../../shared/branding/brand';

/** Escapa texto e atributo HTML. Tudo que vem do banco passa por aqui. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// CSS fixo: a CSP da página libera só o hash deste bloco (sem 'unsafe-inline').
const CSS = [
  ':root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--text:#16181d;--muted:#5b6170;--accent:#15803d;--on-accent:#fff;--line:#e3e6eb}',
  '@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b21;--text:#eef0f3;--muted:#a3a9b5;--accent:#22c55e;--on-accent:#052e16;--line:#2a2f38}}',
  '*{box-sizing:border-box}',
  'body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:24px 16px;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  'main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:32px 24px;text-align:center}',
  'h1{margin:0 0 8px;font-size:1.5rem;line-height:1.25;overflow-wrap:anywhere}',
  'p{margin:0 0 8px;color:var(--muted);overflow-wrap:anywhere}',
  'strong{color:var(--text)}',
  '.btn{display:block;margin-top:24px;padding:16px;border-radius:14px;background:var(--accent);color:var(--on-accent);font-weight:700;font-size:1.125rem;text-decoration:none}',
  '.btn:focus-visible{outline:3px solid var(--text);outline-offset:3px}',
  '.hint{margin-top:16px;font-size:.875rem}',
  'footer{font-size:.75rem;color:var(--muted)}',
].join('');

const CSS_HASH = createHash('sha256').update(CSS).digest('base64');

/** CSP só desta página: nada carrega de fora, nenhum script, estilo só pelo hash. */
export const PUBLIC_PAGE_CSP = [
  "default-src 'none'",
  `style-src 'sha256-${CSS_HASH}'`,
  "img-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export interface PublicPageInput {
  /** Texto puro (escapado aqui). */
  title: string;
  heading: string;
  /** HTML já escapado pelo chamador. */
  bodyHtml: string;
  description?: string;
  action?: { href: string; label: string };
  refreshUrl?: string;
  /** Texto puro abaixo do botão. */
  hint?: string;
}

export function renderPublicPage(page: PublicPageInput): string {
  const title = escapeHtml(page.title);
  const description = page.description ? escapeHtml(page.description) : '';
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${title}</title>`,
    description ? `<meta name="description" content="${description}">` : '',
    `<meta property="og:title" content="${title}">`,
    description ? `<meta property="og:description" content="${description}">` : '',
    '<meta property="og:type" content="website">',
    page.refreshUrl ? `<meta http-equiv="refresh" content="1;url=${escapeHtml(page.refreshUrl)}">` : '',
    `<style>${CSS}</style>`,
  ].filter(Boolean).join('');
  const action = page.action
    ? `<a class="btn" href="${escapeHtml(page.action.href)}" rel="noopener noreferrer">${escapeHtml(page.action.label)}</a>`
    : '';
  const hint = page.hint ? `<p class="hint">${escapeHtml(page.hint)}</p>` : '';
  return `<!doctype html><html lang="pt-BR"><head>${head}</head><body><main><h1>${escapeHtml(page.heading)}</h1>${page.bodyHtml}${action}${hint}</main><footer>${escapeHtml(APP_NAME)}</footer></body></html>`;
}
