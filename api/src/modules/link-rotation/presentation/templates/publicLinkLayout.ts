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
  'footer{display:flex;align-items:center;gap:8px;font-size:.75rem;color:var(--muted)}',
  'footer img{width:20px;height:20px;border-radius:5px}',
  '.grp{display:flex;align-items:center;gap:12px;margin-top:16px;padding:12px;border:1px solid var(--line);border-radius:14px;text-align:left}',
  '.av{flex:none;width:52px;height:52px;border-radius:50%;object-fit:cover;background:var(--line)}',
  '.av-i{display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.25rem;color:var(--muted)}',
  '.gi{flex:1;min-width:0}',
  '.gn{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700;color:var(--text)}',
  '.gs{display:block;font-size:.8125rem;color:var(--muted)}',
].join('');

const CSS_HASH = createHash('sha256').update(CSS).digest('base64');

/**
 * Identidade da página: arquivos de marca servidos pelo painel (favicon, logo) e origem do
 * armazenamento de mídia (foto do grupo). O navegador baixa direto dessas origens, sem custo
 * para a API. Sem configuração, a página sai sem imagens.
 */
export interface PublicPageBranding {
  /** Origem do painel, ex. `https://app.copysync.app` (arquivos em `/assets/brand/`). */
  assetBaseUrl: string | null;
  /** Origem pública do armazenamento de mídia, ex. `https://media.copysync.app`. */
  mediaOrigin: string | null;
}

const originOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
};

let branding: PublicPageBranding = { assetBaseUrl: null, mediaOrigin: null };
let csp = buildCsp();

function buildCsp(): string {
  const img = [branding.assetBaseUrl, branding.mediaOrigin].filter((o): o is string => !!o);
  return [
    "default-src 'none'",
    `style-src 'sha256-${CSS_HASH}'`,
    `img-src ${img.length ? [...new Set(img)].join(' ') : "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Chamado uma vez na composição. Só origens https são aceitas. */
export function configurePublicPageBranding(input: { panelUrl?: string | null; mediaUrl?: string | null }): void {
  branding = { assetBaseUrl: originOf(input.panelUrl), mediaOrigin: originOf(input.mediaUrl) };
  csp = buildCsp();
}

/** CSP só desta página: nenhum script, estilo só pelo hash, imagem só das origens de marca e mídia. */
export function publicPageCsp(): string {
  return csp;
}

/** Foto do grupo só se vier do armazenamento de mídia (a CSP bloquearia qualquer outra). */
export function allowedMediaUrl(url: string | null | undefined): string | null {
  return url && branding.mediaOrigin && originOf(url) === branding.mediaOrigin ? url : null;
}

const brandAsset = (file: string): string | null =>
  branding.assetBaseUrl ? `${branding.assetBaseUrl}/assets/brand/${file}` : null;

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
  /** Imagem da prévia em redes sociais (absoluta). Padrão: ícone da marca. */
  image?: string | null;
}

export function renderPublicPage(page: PublicPageInput): string {
  const title = escapeHtml(page.title);
  const description = page.description ? escapeHtml(page.description) : '';
  const icon = brandAsset('favicon-32.png');
  const touch = brandAsset('apple-touch-icon.png');
  const logo = brandAsset('icon-192.png');
  const ogImage = page.image ?? brandAsset('icon-512.png');
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
    ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : '',
    icon ? `<link rel="icon" type="image/png" sizes="32x32" href="${escapeHtml(icon)}">` : '',
    touch ? `<link rel="apple-touch-icon" href="${escapeHtml(touch)}">` : '',
    page.refreshUrl ? `<meta http-equiv="refresh" content="1;url=${escapeHtml(page.refreshUrl)}">` : '',
    `<style>${CSS}</style>`,
  ].filter(Boolean).join('');
  const action = page.action
    ? `<a class="btn" href="${escapeHtml(page.action.href)}" rel="noopener noreferrer">${escapeHtml(page.action.label)}</a>`
    : '';
  const hint = page.hint ? `<p class="hint">${escapeHtml(page.hint)}</p>` : '';
  return `<!doctype html><html lang="pt-BR"><head>${head}</head><body><main><h1>${escapeHtml(page.heading)}</h1>${page.bodyHtml}${action}${hint}</main><footer>${logo ? `<img src="${escapeHtml(logo)}" width="20" height="20" alt="">` : ''}${escapeHtml(APP_NAME)}</footer></body></html>`;
}
