/**
 * Regras puras da conexão de sessão (sem React), testadas em `utils.test.ts`.
 * A API valida e normaliza o número de novo — aqui é só para orientar o usuário antes do envio.
 */

import type { SessionEngine, SessionItem, SessionStatus } from '@/types/api.types';

/** Tempo de vida de cada QR: igual ao `qrTimeout` do adapter Baileys na API (2 min). */
export const QR_TTL_MS = 120_000;
/** O token `tg://login` do Telegram troca a cada ~30 s; o polling pega o novo. */
export const TELEGRAM_QR_TTL_MS = 30_000;
/** Espera entre dois "Reenviar código" do Telegram (contagem local: não vem da API). */
export const TELEGRAM_CODE_RESEND_MS = 60_000;
/** Tamanho do código de login que chega no app Telegram. */
export const TELEGRAM_CODE_LENGTH = 5;

export type SessionChannel = 'whatsapp' | 'telegram';

export const channelOf = (engine: string | null | undefined): SessionChannel =>
  engine === 'telegram' ? 'telegram' : 'whatsapp';

export const engineOf = (channel: SessionChannel): SessionEngine =>
  channel === 'telegram' ? 'telegram' : 'baileys';

/** Sessão no meio de um login (QR, pareamento, código ou senha do Telegram, ou conectando). */
export const isAwaitingStatus = (status: SessionStatus): boolean =>
  status === 'CONNECTING' || status === 'AWAITING_QR' || status === 'AWAITING_PAIRING'
  || status === 'AWAITING_CODE' || status === 'AWAITING_PASSWORD';

export const isTelegramSession = (session: Pick<SessionItem, 'engine'>): boolean =>
  session.engine === 'telegram';
/** Folga após zerar a contagem antes de declarar o QR expirado (o polling pode atrasar). */
export const QR_EXPIRY_GRACE_MS = 8_000;

export const SESSION_NAME_MIN = 2;
export const SESSION_NAME_MAX = 40;

export const onlyDigits = (value: string) => value.replace(/\D/g, '');

/**
 * Normaliza o que o usuário digitou para `55DDDNÚMERO`.
 * Aceita 10–11 dígitos (DDD + número) ou 12–13 começando com 55. DDD não começa com 0.
 * Devolve `null` quando não dá para confiar no número.
 */
export function normalizeBrazilPhone(input: string): string | null {
  let digits = onlyDigits(input);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2);
  }
  if (digits.length !== 10 && digits.length !== 11) return null;
  if (digits[0] === '0' || digits[1] === '0') return null;
  // Celular com 11 dígitos sempre começa com 9 depois do DDD.
  if (digits.length === 11 && digits[2] !== '9') return null;
  return `55${digits}`;
}

/** `5511987654321` → `+55 (11) 98765-4321`. Valor fora do padrão volta como veio. */
export function formatBrazilPhone(value: string | null | undefined): string {
  if (!value) return '';
  const digits = onlyDigits(value.split('@')[0].split(':')[0]);
  // Só formata número brasileiro com DDI (o WhatsApp sempre devolve o DDI); o resto fica como veio.
  if (!digits.startsWith('55') || (digits.length !== 12 && digits.length !== 13)) return value;
  const local = digits.slice(2);
  if (local.length === 11) return `+55 (${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `+55 (${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return value;
}

/**
 * Telefone de conta Telegram: qualquer país, com DDI, só dígitos (`5511987654321`).
 * Aceita `+55`, máscara e espaços. Sem DDI e com 10–11 dígitos válidos no padrão brasileiro,
 * assume o Brasil. Devolve `null` quando não dá para confiar no número (E.164: 8–15 dígitos).
 */
export function normalizeInternationalPhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = onlyDigits(trimmed);
  if (!trimmed.startsWith('+')) {
    const brazil = normalizeBrazilPhone(digits);
    if (brazil) return brazil;
  }
  if (digits.length < 8 || digits.length > 15) return null;
  if (digits[0] === '0') return null;
  return digits;
}

/** Número com DDI para exibição: brasileiro ganha máscara; os demais só o `+`. */
export function formatInternationalPhone(value: string | null | undefined): string {
  if (!value) return '';
  const formatted = formatBrazilPhone(value);
  if (formatted !== value) return formatted;
  const digits = onlyDigits(value);
  return digits ? `+${digits}` : value;
}

export const isValidSessionName = (name: string) => {
  const len = name.trim().length;
  return len >= SESSION_NAME_MIN && len <= SESSION_NAME_MAX;
};

/** Segundos restantes do QR atual (nunca negativo). */
export function qrSecondsLeft(issuedAt: number, now: number, ttlMs = QR_TTL_MS): number {
  return Math.max(0, Math.ceil((issuedAt + ttlMs - now) / 1000));
}

/** O QR passou da validade e da folga sem que um novo chegasse. */
export function isQrExpired(
  issuedAt: number,
  now: number,
  ttlMs = QR_TTL_MS,
  graceMs = QR_EXPIRY_GRACE_MS,
): boolean {
  return now - issuedAt >= ttlMs + graceMs;
}

/** `19` → `0:19`; `75` → `1:15`. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** `ABCD1234` → `ABCD-1234`; já formatado ou fora do padrão volta normalizado em maiúsculas. */
export function formatPairingCode(code: string): string {
  const clean = code.replace(/[^0-9a-z]/gi, '').toUpperCase();
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : code.toUpperCase();
}

/**
 * `returnTo` vindo da URL só vale como caminho interno do painel (`/…`). Recusa URL absoluta,
 * `//host` (protocolo relativo) e barra invertida — evita redirecionamento aberto.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f]/.test(value)) return null;
  return value;
}

/** Acrescenta `sessionId` ao caminho de volta, respeitando query já existente. */
export function withSessionId(path: string, sessionId: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}sessionId=${encodeURIComponent(sessionId)}`;
}
