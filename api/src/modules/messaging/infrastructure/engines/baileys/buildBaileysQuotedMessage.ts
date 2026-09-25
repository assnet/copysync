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

export interface QuoteBuildOptions {
  /**
   * Autor da citada já resolvido pelo adapter para o endereçamento do grupo (o LID em grupo
   * LID). Quando vem, vale também para mensagem nossa: o Baileys usaria o número da sessão
   * (`userJid`, com `TODO: Add support for LIDs`), mas em grupo LID a mensagem saiu com o LID
   * como autor e os clientes oficiais citam pelo LID.
   */
  authorJid?: string | null;
}

/**
 * Monta a citação a partir da referência gravada pelo chat.
 *
 * O Baileys copia a key para o `contextInfo` (`Utils/messages.js`, `generateWAMessageFromContent`):
 * - `key.remoteJid` diferente do destino vira `contextInfo.remoteJid` — citação "de outra
 *   conversa". Por isso a key usa o próprio `chatJid` e uma referência de outro chat não cita.
 * - `key.fromMe` faz a lib usar o número da sessão como autor; `key.participant` é usado nos
 *   demais casos. Sem nenhum dos dois, o autor vira `key.remoteJid`: em grupo, o próprio grupo.
 *   Por isso grupo sem autor conhecido não cita (o envio segue, só sem citação).
 *
 * O conteúdo citado é mínimo e nunca vazio: `proto.Message.create` descarta campos vazios e a
 * lib quebra ao procurar o tipo (lição de `dea6c36`).
 */
export function buildBaileysQuotedMessage(
  ref: QuotedMessageRef,
  chatJid: string,
  normalizeJid: (value: string) => string,
  options: QuoteBuildOptions = {},
): QuoteBuildResult {
  if (normalizeJid(ref.remoteJid) !== chatJid) return { quoted: null, skipped: 'different_chat' };

  const message = quotedContent(ref);
  const isGroup = chatJid.endsWith('@g.us');
  const base = { remoteJid: chatJid, id: ref.externalId };

  if (isGroup && options.authorJid) {
    return { quoted: { key: { ...base, fromMe: false, participant: options.authorJid }, message }, skipped: null };
  }
  if (isGroup && !ref.fromMe && !ref.participant) {
    return { quoted: null, skipped: 'group_without_participant' };
  }

  return {
    quoted: {
      key: {
        ...base,
        fromMe: ref.fromMe,
        ...(isGroup && !ref.fromMe && ref.participant
          ? { participant: normalizeJid(ref.participant) }
          : {}),
      },
      message,
    },
    skipped: null,
  };
}

/** Texto de preview nunca vazio — string vazia some no proto e o destinatário vê citação em branco. */
function nonEmpty(text: string | null | undefined): string {
  return text && text.trim() ? text : ' ';
}

/** Só os campos presentes: o proto não aceita `undefined` como "ausente" em todos os caminhos. */
function compact(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

function quotedContent(ref: QuotedMessageRef): Record<string, unknown> {
  const text = ref.body && ref.body.trim() ? ref.body : null;
  const mimetype = ref.mimeType ?? null;
  const seconds = ref.durationSeconds ?? null;
  switch (ref.type.toUpperCase()) {
    case 'IMAGE':    return { imageMessage: compact({ mimetype, caption: text }) };
    case 'VIDEO':    return { videoMessage: compact({ mimetype, caption: text, seconds }) };
    case 'AUDIO':    return { audioMessage: { ...compact({ mimetype }), seconds: seconds ?? 0, ptt: false } };
    case 'DOCUMENT': return { documentMessage: compact({ mimetype, fileName: ref.fileName, title: ref.fileName ?? text }) };
    case 'STICKER':  return { stickerMessage: compact({ mimetype }) };
    case 'VCARD':    return { contactMessage: { displayName: nonEmpty(ref.body) } };
    default:         return { conversation: nonEmpty(ref.body) };
  }
}
