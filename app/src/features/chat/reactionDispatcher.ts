import { chatService } from '@/services/chat.service';
import type { MessageReactionResultApiDto } from '@/types/chat.api.types';
import { selectReactionToSend, type ReactionAggregate } from './reactionsState';

/**
 * Envio agrupado das reações (design §8, regra 3) — módulo TS sem React, singleton por aba.
 *
 * Por mensagem: envia só o último gesto, depois de 400 ms sem clique E ≥ 1000 ms desde o
 * último envio da mesma mensagem. O intervalo do painel (1000) precisa ficar acima do da
 * API (700): mudar um exige conferir o outro.
 *
 * Não há flush: trocar de conversa ou desmontar a página não adianta nada — os temporizadores
 * seguem e o resultado vai para quem estiver inscrito. `reset()` (logout/troca de tenant)
 * cancela tudo, para nada sair com o contexto novo.
 */

export type ReactionErrorCode = 'rate_limited' | 'session_disconnected' | 'failed';

export type ReactionDispatchEvent =
  | { type: 'sent'; messageId: string; requestId: string; discardedIds: string[] }
  | { type: 'discarded'; messageId: string; requestIds: string[] }
  | { type: 'success'; messageId: string; requestId: string; result: MessageReactionResultApiDto }
  | { type: 'error'; messageId: string; requestId: string; code: ReactionErrorCode };

type Listener = (event: ReactionDispatchEvent) => void;
type Gesture = { requestId: string; emoji: string | null };

interface Entry {
  server: ReactionAggregate | null;
  drafts: Gesture[];
  inflight: Gesture[];
  lastClickAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface ReactionDispatcherOptions {
  send: (messageId: string, emoji: string | null) => Promise<MessageReactionResultApiDto>;
  now?: () => number;
  quietMs?: number;
  minIntervalMs?: number;
}

export function classifyReactionError(err: unknown): ReactionErrorCode {
  const { status, code } = (err ?? {}) as { status?: number; code?: string };
  if (status === 429) return 'rate_limited';
  if (code === 'SESSION_NOT_CONNECTED') return 'session_disconnected';
  return 'failed';
}

export function createReactionDispatcher({
  send,
  now = () => Date.now(),
  quietMs = 400,
  minIntervalMs = 1000,
}: ReactionDispatcherOptions) {
  const entries = new Map<string, Entry>();
  const lastSentAt = new Map<string, number>();
  const listeners = new Set<Listener>();
  let seq = 0;
  let epoch = 0;

  const emit = (event: ReactionDispatchEvent) => {
    if (listeners.size === 0) {
      if (event.type === 'error') {
        console.warn('Reação não enviada', { messageId: event.messageId, code: event.code });
      }
      return;
    }
    listeners.forEach((l) => l(event));
  };

  /** Esquece a mensagem quando nada está em espera nem em voo. */
  const release = (messageId: string, entry: Entry) => {
    if (!entry.drafts.length && !entry.inflight.length && !entry.timer) entries.delete(messageId);
  };

  const schedule = (messageId: string, entry: Entry) => {
    if (entry.timer) clearTimeout(entry.timer);
    const sentAt = lastSentAt.get(messageId);
    const due = Math.max(entry.lastClickAt + quietMs, sentAt === undefined ? 0 : sentAt + minIntervalMs);
    entry.timer = setTimeout(() => fire(messageId), Math.max(0, due - now()));
  };

  const fire = (messageId: string) => {
    const entry = entries.get(messageId);
    if (!entry) return;
    entry.timer = null;

    const drafts = entry.drafts;
    entry.drafts = [];
    const decision = selectReactionToSend(entry.server, entry.inflight, drafts);
    if (decision === 'skip') {
      emit({ type: 'discarded', messageId, requestIds: drafts.map((d) => d.requestId) });
      release(messageId, entry);
      return;
    }

    const gesture = drafts[drafts.length - 1];
    entry.inflight.push(gesture);
    lastSentAt.set(messageId, now());
    emit({
      type: 'sent',
      messageId,
      requestId: gesture.requestId,
      discardedIds: drafts.slice(0, -1).map((d) => d.requestId),
    });

    const startedIn = epoch;
    const settle = (event: ReactionDispatchEvent) => {
      if (startedIn !== epoch) return; // reset() no meio: resultado do contexto anterior
      entry.inflight = entry.inflight.filter((g) => g.requestId !== gesture.requestId);
      release(messageId, entry);
      emit(event);
    };
    send(messageId, decision).then(
      (result) => settle({ type: 'success', messageId, requestId: gesture.requestId, result }),
      (err: unknown) =>
        settle({ type: 'error', messageId, requestId: gesture.requestId, code: classifyReactionError(err) }),
    );
  };

  return {
    /**
     * Registra um gesto. `server` é o agregado de servidor visto no clique — base do descarte
     * do vai e volta quando nada está em voo. Devolve o `requestId` do gesto.
     */
    enqueue(messageId: string, emoji: string | null, server: ReactionAggregate | null): string {
      const t = now();
      // Poda: o intervalo mínimo só importa enquanto não venceu.
      for (const [id, at] of lastSentAt) if (t - at >= minIntervalMs && !entries.has(id)) lastSentAt.delete(id);

      const requestId = `reaction-${++seq}`;
      const entry = entries.get(messageId) ?? { server, drafts: [], inflight: [], lastClickAt: t, timer: null };
      entry.server = server;
      entry.lastClickAt = t;
      entry.drafts.push({ requestId, emoji });
      entries.set(messageId, entry);
      schedule(messageId, entry);
      return requestId;
    },

    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Cancela temporizadores, esquece drafts e ignora respostas em voo. */
    reset(): void {
      epoch++;
      entries.forEach((e) => e.timer && clearTimeout(e.timer));
      entries.clear();
      lastSentAt.clear();
    },
  };
}

export type ReactionDispatcher = ReturnType<typeof createReactionDispatcher>;

export const reactionDispatcher = createReactionDispatcher({
  send: (messageId, emoji) => chatService.setMessageReaction(messageId, emoji),
});
