import type { NumberLike } from './normalizeChatState';

/**
 * Recorte da key do Baileys usada por reações. Declarado aqui para que a normalização
 * não dependa dos tipos internos da lib (AGENTS.md §9/§11).
 */
export interface RawReactionKey {
  id?: string | null;
  remoteJid?: string | null;
  /** JID real quando `remoteJid` vem como @lid (privacidade de número). */
  remoteJidAlt?: string | null;
  fromMe?: boolean | null;
  participant?: string | null;
  /** JID real quando `participant` vem como @lid. */
  participantAlt?: string | null;
}

/**
 * Item do evento `messages.reaction`.
 *
 * Atenção — a lib inverte o que a intuição sugere (`Utils/process-message.js`):
 * - `key` (topo) é a key da mensagem **ALVO**
 * - `reaction.key` é a key da mensagem **DE REAÇÃO**, que carrega o autor
 */
export interface RawReactionItem {
  key?: RawReactionKey | null;
  reaction?: {
    key?: RawReactionKey | null;
    /** Emoji; vazio ou ausente = reação removida. */
    text?: string | null;
    senderTimestampMs?: NumberLike;
  } | null;
}

export interface NormalizedReaction {
  targetExternalMessageId: string;
  reactionExternalId: string | null;
  emoji: string | null;
  /** 'self', 'lid:<id>' ou 'pn:<dígitos>' — identidade crua, nunca o telefone resolvido. */
  reactorKey: string;
  /** Telefone para exibição, quando já conhecido pelo próprio evento. */
  reactorPhone: string | null;
  /** JID @lid do autor sem alternativa no evento — o handler tenta o mapeamento da sessão. */
  unresolvedLid: string | null;
  fromMe: boolean;
  isEcho: boolean;
  /** ISO — senderTimestampMs convertido, ou agora quando ausente/inválido. */
  reactedAt: string;
}

export interface NormalizeReactionOptions {
  now?: number;
  /**
   * Consulta (e retira) o id no registro de ecos da sessão. Só é chamada para reação
   * nossa (`fromMe`) com id — o registro fica fora desta função.
   */
  consumeEcho: (reactionId: string) => boolean;
}

function isBroadcast(jid: string | null | undefined): boolean {
  return !!jid && jid.endsWith('@broadcast');
}

function userPart(jid: string): string {
  return jid.split('@')[0].split(':')[0];
}

function isPhoneJid(jid: string | null | undefined): jid is string {
  return !!jid && jid.endsWith('@s.whatsapp.net');
}

function toTimestamp(value: NumberLike, now: number): number {
  if (value === null || value === undefined) return now;
  const ms = typeof value === 'number' ? value : value.toNumber();
  return Number.isFinite(ms) && ms > 0 ? ms : now;
}

/**
 * Traduz um item de `messages.reaction` para o formato interno.
 *
 * Devolve `null` quando o item deve ser ignorado: status/transmissão, alvo sem id, ou
 * reação de terceiro sem autor identificável (grupo sem `participant`). Autor @lid sem
 * alternativa **não** é descartado — segue com `reactorPhone: null`.
 */
export function normalizeReactionEvent(
  item: RawReactionItem,
  options: NormalizeReactionOptions,
): NormalizedReaction | null {
  const now = options.now ?? Date.now();
  const target = item.key;
  const reaction = item.reaction;
  const author = reaction?.key;
  if (!target?.id || !reaction || !author) return null;

  const chatJid = author.remoteJid ?? target.remoteJid;
  if (!chatJid || isBroadcast(chatJid) || isBroadcast(target.remoteJid)) return null;

  const fromMe = author.fromMe === true;
  const reactionExternalId = author.id ?? null;
  const base = {
    targetExternalMessageId: target.id,
    reactionExternalId,
    emoji: reaction.text ? reaction.text : null,
    fromMe,
    reactedAt: new Date(toTimestamp(reaction.senderTimestampMs, now)).toISOString(),
  };

  if (fromMe) {
    const isEcho = reactionExternalId !== null && options.consumeEcho(reactionExternalId);
    return { ...base, reactorKey: 'self', reactorPhone: null, unresolvedLid: null, isEcho };
  }

  const isGroup = chatJid.endsWith('@g.us');
  const authorJid = isGroup ? author.participant : author.remoteJid;
  if (!authorJid) return null;

  if (authorJid.endsWith('@lid')) {
    const alt = isGroup ? author.participantAlt : author.remoteJidAlt;
    const phone = isPhoneJid(alt) ? userPart(alt) : null;
    return {
      ...base,
      reactorKey: `lid:${userPart(authorJid)}`,
      reactorPhone: phone,
      unresolvedLid: phone ? null : authorJid,
      isEcho: false,
    };
  }

  const digits = userPart(authorJid).replace(/\D/g, '');
  return {
    ...base,
    reactorKey: `pn:${digits}`,
    reactorPhone: digits || null,
    unresolvedLid: null,
    isEcho: false,
  };
}
