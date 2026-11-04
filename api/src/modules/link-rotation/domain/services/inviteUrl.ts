/**
 * Link de convite de grupo por canal: funções puras, sem banco. O canal do rodízio é o da sessão
 * escolhida (`Session.engine`); o banco guarda só o code e a URL é remontada aqui.
 *
 * WhatsApp: `https://chat.whatsapp.com/<code>` e variações coladas (sem esquema, `http`, `www.`,
 * `/invite/<code>`, barra final, query e fragmento descartados). Code alfanumérico de 16–32.
 *
 * Telegram: o code é o que vem depois de `t.me/`:
 * - `+<hash>` (convite privado). `t.me/joinchat/<hash>` é o formato antigo e vira `+<hash>`;
 * - `<username>` (grupo ou canal público: 5–32 caracteres, letra no início, letras/dígitos/_).
 * Aceita `t.me`, `telegram.me`, `telegram.dog`, com ou sem esquema/`www.`. Caminho extra
 * (`t.me/<user>/123`, link de mensagem) e rotas reservadas do Telegram são recusados.
 */
export type LinkRotationChannel = 'whatsapp' | 'telegram';

/** Canal do rodízio a partir do engine da sessão (`baileys` e desconhecidos = WhatsApp). */
export function channelForEngine(engine: string | null | undefined): LinkRotationChannel {
  return engine === 'telegram' ? 'telegram' : 'whatsapp';
}

const WHATSAPP_CODE = /^[A-Za-z0-9]{16,32}$/;
const WHATSAPP_URL = /^(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/(?:invite\/)?([^/?#\s]+)\/?(?:[?#].*)?$/i;

const TELEGRAM_URL = /^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.(?:me|dog)\/([^?#\s]+?)\/?(?:[?#].*)?$/i;
const TELEGRAM_HASH = /^[A-Za-z0-9_-]{10,64}$/;
const TELEGRAM_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
/** Caminhos do Telegram que não são grupo/canal (5+ letras; os curtos já caem no tamanho). */
const TELEGRAM_RESERVED = new Set([
  'joinchat', 'addstickers', 'addemoji', 'addtheme', 'addlist', 'share', 'proxy', 'socks',
  'login', 'setlanguage', 'confirmphone', 'boost', 'invoice', 'giftcode', 'contact',
]);

export const INVITE_URL_BASE: Record<LinkRotationChannel, string> = {
  whatsapp: 'https://chat.whatsapp.com/',
  telegram: 'https://t.me/',
};

/** Code do Telegram (o que vem depois de `t.me/`), normalizado; null se não for convite/público. */
export function normalizeTelegramCode(path: string): string | null {
  const joinchat = /^joinchat\/([^/]+)$/i.exec(path);
  const hash = joinchat ? joinchat[1]! : path.startsWith('+') ? path.slice(1) : null;
  if (hash !== null) return TELEGRAM_HASH.test(hash) ? `+${hash}` : null;
  if (!TELEGRAM_USERNAME.test(path) || path.endsWith('_')) return null;
  return TELEGRAM_RESERVED.has(path.toLowerCase()) ? null : path;
}

/** Valida o link colado no canal do rodízio e devolve só o code, ou `null` se inválido. */
export function parseInviteCode(raw: string, channel: LinkRotationChannel): string | null {
  const text = raw.trim();
  if (channel === 'telegram') {
    const path = TELEGRAM_URL.exec(text)?.[1];
    return path ? normalizeTelegramCode(path) : null;
  }
  const code = WHATSAPP_URL.exec(text)?.[1];
  return code && WHATSAPP_CODE.test(code) ? code : null;
}

export function inviteUrlFromCode(code: string, channel: LinkRotationChannel): string {
  return `${INVITE_URL_BASE[channel]}${code}`;
}

/**
 * Teto de membros por grupo, por canal. WhatsApp: limite real de 1.024. Telegram: grupo básico vai
 * até 200 e é convertido em supergrupo ao crescer; supergrupo até 200.000; canal não tem limite de
 * inscritos — nele o teto é só o ponto em que o usuário quer passar para o próximo grupo.
 */
export const GROUP_CAPACITY: Record<LinkRotationChannel, { min: number; max: number; default: number }> = {
  whatsapp: { min: 50, max: 1024, default: 1000 },
  telegram: { min: 50, max: 200_000, default: 10_000 },
};
