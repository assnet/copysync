import type { ChatMessageReaction } from '../entities/ChatMessageReaction';

/** Recorte do estado gravado que a decisão precisa conhecer. */
export type CurrentReaction = Pick<ChatMessageReaction, 'emoji' | 'reactedAt'>;

/** Recorte do evento recebido: `emoji: null` = remoção. */
export interface IncomingReaction {
  emoji: string | null;
  reactedAt: Date;
}

/**
 * Resultado da decisão. Mora aqui, junto da regra que o produz: o contrato do
 * repositório importa deste módulo, e não o contrário.
 */
export interface ReactionWriteDecision {
  /** Gravar a linha: o evento não é mais antigo que o estado gravado. */
  applied: boolean;
  /** O estado visível (emoji ativo) mudou — só então alguém publica no WS. */
  changed: boolean;
}

/**
 * Last-write-wins por autor, comparando `reactedAt`.
 *
 * Regra pura, sem banco: o repositório trava o par (mensagem, autor), lê a linha atual,
 * chama esta função e só grava quando `applied`. Quem recebe `changed` publica — assim
 * o `PUT` do painel e o eco da engine, em qualquer ordem, geram um único evento.
 *
 * - Carimbo menor que o gravado: descartado (eco atrasado não sobrescreve gesto novo)
 * - Carimbo igual conta como "≥": o eco do nosso envio reaplica sem publicar
 * - Remoção sem estado grava tombstone (guarda o carimbo), mas nada visível mudou
 */
export function decideReactionWrite(
  current: CurrentReaction | null,
  incoming: IncomingReaction,
): ReactionWriteDecision {
  if (!current) {
    return { applied: true, changed: incoming.emoji !== null };
  }

  if (incoming.reactedAt.getTime() < current.reactedAt.getTime()) {
    return { applied: false, changed: false };
  }

  return { applied: true, changed: incoming.emoji !== current.emoji };
}
