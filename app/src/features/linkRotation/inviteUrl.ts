/**
 * Convite de grupo por canal no painel — espelho de `api/.../domain/services/inviteUrl.ts`
 * (a API valida de novo). WhatsApp: `https://chat.whatsapp.com/<code>`. Telegram: `t.me/+<code>`,
 * `t.me/joinchat/<code>` ou `t.me/<username>` (grupo/canal público), com ou sem esquema/`www.`,
 * também em `telegram.me`/`telegram.dog`.
 */
import type { RotationChannel } from './types';

const WHATSAPP_URL = /^(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{16,32})\/?(?:[?#].*)?$/i;
const TELEGRAM_URL = /^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.(?:me|dog)\/([^?#\s]+?)\/?(?:[?#].*)?$/i;
const TELEGRAM_HASH = /^[A-Za-z0-9_-]{10,64}$/;
const TELEGRAM_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const TELEGRAM_RESERVED = new Set([
  'joinchat', 'addstickers', 'addemoji', 'addtheme', 'addlist', 'share', 'proxy', 'socks',
  'login', 'setlanguage', 'confirmphone', 'boost', 'invoice', 'giftcode', 'contact',
]);

function telegramCode(path: string): string | null {
  const joinchat = /^joinchat\/([^/]+)$/i.exec(path);
  const hash = joinchat ? joinchat[1]! : path.startsWith('+') ? path.slice(1) : null;
  if (hash !== null) return TELEGRAM_HASH.test(hash) ? `+${hash}` : null;
  if (!TELEGRAM_USERNAME.test(path) || path.endsWith('_')) return null;
  return TELEGRAM_RESERVED.has(path.toLowerCase()) ? null : path;
}

/** O link colado vale para o canal do rodízio? */
export function isValidInviteUrl(raw: string, channel: RotationChannel): boolean {
  const text = raw.trim();
  if (channel === 'telegram') {
    const path = TELEGRAM_URL.exec(text)?.[1];
    return Boolean(path && telegramCode(path));
  }
  return WHATSAPP_URL.test(text);
}

/** Exemplo de link mostrado no campo (placeholder). */
export const INVITE_URL_EXAMPLE: Record<RotationChannel, string> = {
  whatsapp: 'https://chat.whatsapp.com/…',
  telegram: 'https://t.me/+…',
};
