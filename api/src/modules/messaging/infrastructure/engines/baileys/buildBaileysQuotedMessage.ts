import type { QuotedMessageRef } from '../../../domain/contracts/IMessagingEngine';

/**
 * Mensagem citada no formato que o `sendMessage(jid, content, { quoted })` do Baileys lê.
 * Declarada aqui para a montagem não depender dos tipos internos da lib (AGENTS.md §9/§11);
 * o adapter faz o cast para `WAMessage`.
 */
export interface BaileysQuotedMessage {
  key: { remoteJid: string; fromMe: boolean; id: string; participant?: string };
  message: Record<string, unknown>;
}

export type QuoteSkipReason = 'different_chat' | 'group_without_participant';

export type QuoteBuildResult =
  | { quoted: BaileysQuotedMessage; skipped: null }
  | { quoted: null; skipped: QuoteSkipReason };

/**
 * Monta a citação a partir da referência gravada pelo chat.
 *
 * O Baileys copia a key para o `contextInfo` (`Utils/messages.js`, `generateWAMessageFromContent`):
 * - `key.remoteJid` diferente do destino vira `contextInfo.remoteJid` — citação "de outra
 *   conversa". Por isso a key usa o próprio `chatJid` e uma referência de outro chat não cita.
 * - Sem `participant`, o autor citado vira `key.remoteJid`: em grupo, o próprio grupo. Por
 *   isso grupo sem autor conhecido não cita (o envio segue, só sem citação).
 * - Mensagem nossa usa o JID da sessão como autor; o `participant` é ignorado.
 *
 * O conteúdo citado é mínimo e nunca vazio: `proto.Message.create` descarta campos vazios e a
 * lib quebra ao procurar o tipo (lição de `dea6c36`).
 */
export function buildBaileysQuotedMessage(
  ref: QuotedMessageRef,
  chatJid: string,
  normalizeJid: (value: string) => string,
): QuoteBuildResult {
  if (normalizeJid(ref.remoteJid) !== chatJid) return { quoted: null, skipped: 'different_chat' };

  const isGroup = chatJid.endsWith('@g.us');
  if (isGroup && !ref.fromMe && !ref.participant) {
    return { quoted: null, skipped: 'group_without_participant' };
  }

  return {
    quoted: {
      key: {
        remoteJid: chatJid,
        fromMe: ref.fromMe,
        id: ref.externalId,
        ...(isGroup && !ref.fromMe && ref.participant
          ? { participant: normalizeJid(ref.participant) }
          : {}),
      },
      message: quotedContent(ref.type, ref.body),
    },
    skipped: null,
  };
}

/** Texto de preview nunca vazio — string vazia some no proto e o destinatário vê citação em branco. */
function nonEmpty(text: string | null | undefined): string {
  return text && text.trim() ? text : ' ';
}

function quotedContent(type: string, body: string | null): Record<string, unknown> {
  const text = body && body.trim() ? body : null;
  switch (type.toUpperCase()) {
    case 'IMAGE':    return { imageMessage: text ? { caption: text } : {} };
    case 'VIDEO':    return { videoMessage: text ? { caption: text } : {} };
    case 'AUDIO':    return { audioMessage: { seconds: 0, ptt: false } };
    case 'DOCUMENT': return { documentMessage: text ? { title: text } : {} };
    case 'STICKER':  return { stickerMessage: {} };
    case 'VCARD':    return { contactMessage: { displayName: nonEmpty(body) } };
    default:         return { conversation: nonEmpty(body) };
  }
}
