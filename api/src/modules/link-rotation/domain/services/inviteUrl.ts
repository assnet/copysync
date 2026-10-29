/**
 * Link de convite de grupo do WhatsApp: função pura, sem banco.
 *
 * Aceita `https://chat.whatsapp.com/<code>` e variações coladas pelo usuário: sem esquema, `http`,
 * `www.`, `/invite/<code>`, barra final, query string e fragmento (descartados). O code é
 * alfanumérico (hoje 22 caracteres; aceita 16–32). Devolve só o code ou `null` se inválido.
 */
const INVITE_CODE = /^[A-Za-z0-9]{16,32}$/;
const INVITE_URL = /^(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/(?:invite\/)?([^/?#\s]+)\/?(?:[?#].*)?$/i;

export const INVITE_URL_BASE = 'https://chat.whatsapp.com/';

export function parseInviteCode(raw: string): string | null {
  const match = INVITE_URL.exec(raw.trim());
  const code = match?.[1];
  return code && INVITE_CODE.test(code) ? code : null;
}

export function inviteUrlFromCode(code: string): string {
  return `${INVITE_URL_BASE}${code}`;
}
