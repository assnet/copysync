/**
 * Id externo de mensagem do Telegram: `<peerId>_<msgId>` (ex.: `-1001234567890_42`, `123456_7`).
 *
 * O `msg.id` do Telegram só é único dentro do chat (supergrupo/canal) ou da caixa da conta (usuário e
 * grupo pequeno); o resto do sistema deduplica por id externo (`CapturedOffer @@unique([sessionId,
 * sourceExternalMessageId])`, `findByExternalId` do chat). Prefixar o peer torna o id único por sessão.
 * Tudo que devolve um id à engine (citação, reação, lidas) passa por `parseTelegramMessageId`.
 * Ids provisórios de mídia (`tg-<hex>`) não são de mensagem do Telegram e não fazem parse.
 */
export function composeTelegramMessageId(peerId: string, msgId: number): string {
  return `${peerId}_${msgId}`;
}

export interface ParsedTelegramMessageId {
  /** Peer marcado; null em id legado (só o número, gravado antes do formato composto). */
  peerId: string | null;
  msgId: number;
}

export function parseTelegramMessageId(externalId: string | null | undefined): ParsedTelegramMessageId | null {
  if (!externalId) return null;
  const m = /^(?:(-?\d+)_)?(\d{1,10})$/.exec(externalId);
  if (!m) return null;
  const msgId = Number(m[2]);
  if (!Number.isSafeInteger(msgId) || msgId <= 0) return null;
  return { peerId: m[1] ?? null, msgId };
}
