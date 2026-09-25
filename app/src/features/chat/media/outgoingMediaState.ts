import type { ChatMessage, MessageStatus, MessageUploadState } from '../types';

/**
 * Estado das bolhas de mídia em envio (design §11 e §14 "Estado otimista"; MEDIA-08/18/19).
 * Só funções puras: upload, confirmação e `URL.revokeObjectURL` ficam no hook, que despacha os
 * eventos abaixo e executa os efeitos que a transição devolve (`revoke`, `confirmed`).
 *
 * As bolhas vivem fora da lista do servidor e são sobrepostas na renderização
 * (`overlayOutgoing`, mesmo padrão do `overlayPending` das reações): recarregar, buscar ou
 * paginar a conversa não as apaga.
 *
 * Evento sem efeito devolve o MESMO `state` — o React não re-renderiza.
 */

/** Como tratar o erro de uma etapa do envio (tabela do design §14). */
export type UploadFailureKind =
  | 'canceled'
  | 'network'
  | 'session'
  | 'in_progress'
  | 'incomplete'
  | 'not_found'
  | 'rejected';

export interface OutgoingMediaItem {
  tmpId: string;
  conversationId: string;
  /** Bolha pronta para renderizar: `mediaUrl` `blob:`, `status: 'sending'` e `upload` em dia. */
  message: ChatMessage;
  uploadId?: string;
  phase: MessageUploadState['phase'];
  /** 0 a 100, nunca regride dentro do mesmo upload. */
  progress: number;
  /** Erro visível na bolha; `null` enquanto o envio anda sozinho. */
  error: NonNullable<MessageUploadState['error']> | null;
  /** Id da mensagem que o servidor já gravou para esta bolha (ex.: `GET` do upload). */
  realMessageId?: string;
}

/** Status que chegou pelo WS antes do 202 (§11); `at` em ms, hora local do recebimento. */
export interface EarlyStatus {
  status: MessageStatus;
  at: number;
}

export interface OutgoingMediaState {
  /** Bolhas por conversa, na ordem de criação. Conversa sem bolha não tem chave. */
  byConversation: Record<string, OutgoingMediaItem[]>;
  earlyStatusById: Record<string, EarlyStatus>;
}

export type OutgoingMediaEvent =
  | { type: 'ADDED'; message: ChatMessage }
  | { type: 'UPLOAD_STARTED'; tmpId: string; uploadId: string }
  | { type: 'PROGRESS'; tmpId: string; progress: number }
  | { type: 'CONFIRMING'; tmpId: string }
  | { type: 'LINKED'; tmpId: string; messageId: string }
  | { type: 'CONFIRMED'; tmpId: string; message: ChatMessage }
  | { type: 'FAILED'; tmpId: string; kind: UploadFailureKind }
  | { type: 'CANCELED'; tmpId: string }
  | { type: 'RETRY'; tmpId: string }
  /** Despachado pela página só quando o `messageId` ainda não está na lista dela. */
  | { type: 'WS_STATUS'; messageId: string; status: MessageStatus; at: number }
  | { type: 'PRUNE'; now: number };

export interface OutgoingMediaTransition {
  state: OutgoingMediaState;
  /** `blob:` que o hook deve revogar. */
  revoke: string[];
  /** Só no `CONFIRMED`: mensagem real, com o status antecipado aplicado, para a página inserir. */
  confirmed?: ChatMessage;
}

export const EARLY_STATUS_TTL_MS = 2 * 60_000;

export const initialOutgoingMediaState: OutgoingMediaState = { byConversation: {}, earlyStatusById: {} };

/**
 * Traduz o erro de uma chamada do envio. O interceptor do `apiClient` rejeita com `status` e
 * `code` da API; sem `status` = rede. `HTTP_ERROR` (413/400 do próprio Fastify) decide por status.
 */
export function failureKind(error: { status?: number; code?: string } | null, aborted: boolean): UploadFailureKind {
  if (aborted) return 'canceled';
  switch (error?.code) {
    case 'SESSION_NOT_CONNECTED':
      return 'session';
    case 'UPLOAD_IN_PROGRESS':
      return 'in_progress';
    case 'UPLOAD_INCOMPLETE':
      return 'incomplete';
    case 'UPLOAD_NOT_FOUND':
      return 'not_found';
  }
  const status = error?.status;
  // 5xx (deploy, disco, ffmpeg), 408 e 429 passam com o tempo: "Tentar de novo".
  if (status === undefined || status >= 500 || status === 408 || status === 429) return 'network';
  // 413/415/422 e demais 4xx: repetir não muda a resposta — só descartar.
  return 'rejected';
}

/** Status antecipado por cima da mensagem real — só enquanto ela ainda consta como enviando. */
export function applyEarlyStatus(message: ChatMessage, earlyStatusById: Record<string, EarlyStatus>): ChatMessage {
  const early = earlyStatusById[message.id];
  if (!early || message.status !== 'sending' || early.status === message.status) return message;
  return { ...message, status: early.status };
}

/** Lista renderizada: servidor + bolhas ao fim, na ordem de criação (onde a mensagem real entrará). */
export function overlayOutgoing(
  serverMessages: ChatMessage[],
  outgoingItems: OutgoingMediaItem[] | undefined,
): ChatMessage[] {
  if (!outgoingItems?.length) return serverMessages;
  const serverIds = new Set(serverMessages.map((m) => m.id));
  const bubbles = outgoingItems
    .filter((i) => !(i.realMessageId && serverIds.has(i.realMessageId)))
    .map((i) => i.message);
  return bubbles.length ? [...serverMessages, ...bubbles] : serverMessages;
}

// ── Redutor ───────────────────────────────────────────────────────────────────

type ItemPatch = Partial<Pick<OutgoingMediaItem, 'uploadId' | 'phase' | 'progress' | 'error'>>;

const withoutEffects = (state: OutgoingMediaState): OutgoingMediaTransition => ({ state, revoke: [] });

const blobOf = (item: OutgoingMediaItem): string[] =>
  item.message.mediaUrl?.startsWith('blob:') ? [item.message.mediaUrl] : [];

/** Aplica o patch e remonta `message.upload` — a bolha nunca diverge dos campos do item. */
function patchItem(item: OutgoingMediaItem, patch: ItemPatch): OutgoingMediaItem {
  const next = { ...item, ...patch };
  const upload: MessageUploadState = { phase: next.phase, progress: next.progress, error: next.error };
  if (next.uploadId) upload.uploadId = next.uploadId;
  return { ...next, message: { ...next.message, status: 'sending', upload } };
}

function locate(state: OutgoingMediaState, tmpId: string): { conversationId: string; index: number } | null {
  for (const [conversationId, items] of Object.entries(state.byConversation)) {
    const index = items.findIndex((i) => i.tmpId === tmpId);
    if (index >= 0) return { conversationId, index };
  }
  return null;
}

/** Troca (ou remove, com `null`) o item; conversa que fica sem bolha perde a chave. */
function replaceItem(
  state: OutgoingMediaState,
  conversationId: string,
  index: number,
  item: OutgoingMediaItem | null,
): OutgoingMediaState {
  const items = state.byConversation[conversationId].slice();
  if (item) items[index] = item;
  else items.splice(index, 1);
  const byConversation = { ...state.byConversation, [conversationId]: items };
  if (!items.length) delete byConversation[conversationId];
  return { ...state, byConversation };
}

function remove(state: OutgoingMediaState, tmpId: string): OutgoingMediaTransition {
  const at = locate(state, tmpId);
  if (!at) return withoutEffects(state);
  const item = state.byConversation[at.conversationId][at.index];
  return { state: replaceItem(state, at.conversationId, at.index, null), revoke: blobOf(item) };
}

function update(state: OutgoingMediaState, tmpId: string, patch: (item: OutgoingMediaItem) => ItemPatch | null) {
  const at = locate(state, tmpId);
  if (!at) return withoutEffects(state);
  const item = state.byConversation[at.conversationId][at.index];
  const p = patch(item);
  if (!p || Object.entries(p).every(([k, v]) => item[k as keyof ItemPatch] === v)) return withoutEffects(state);
  return withoutEffects(replaceItem(state, at.conversationId, at.index, patchItem(item, p)));
}

/** Decisão por `kind` (tabela §14). Só `network`, `session` e `rejected` aparecem na bolha. */
function failurePatch(kind: Exclude<UploadFailureKind, 'canceled'>): ItemPatch {
  switch (kind) {
    case 'network':
    case 'session':
    case 'rejected':
      return { error: kind };
    case 'in_progress':
      // O hook reconfirma a cada 2 s até o 200 (idempotente).
      return { phase: 'confirming', error: null };
    case 'incomplete':
      // O hook retoma as partes pelo mesmo `uploadId`.
      return { phase: 'uploading', error: null };
    case 'not_found':
      // Upload expirou ou sumiu: o hook sobe de novo a partir do `File` retido.
      return { phase: 'uploading', progress: 0, uploadId: undefined, error: null };
  }
}

export function reduceOutgoingMedia(state: OutgoingMediaState, event: OutgoingMediaEvent): OutgoingMediaTransition {
  switch (event.type) {
    case 'ADDED': {
      const { id: tmpId, conversationId } = event.message;
      if (locate(state, tmpId)) return withoutEffects(state);
      const item = patchItem(
        { tmpId, conversationId, message: event.message, phase: 'uploading', progress: 0, error: null },
        {},
      );
      const items = [...(state.byConversation[conversationId] ?? []), item];
      return withoutEffects({ ...state, byConversation: { ...state.byConversation, [conversationId]: items } });
    }
    case 'UPLOAD_STARTED':
      return update(state, event.tmpId, () => ({ uploadId: event.uploadId, phase: 'uploading' }));
    case 'PROGRESS': {
      const target = Math.min(100, Math.max(0, event.progress));
      return update(state, event.tmpId, (i) => ({ progress: Math.max(i.progress, target) }));
    }
    case 'CONFIRMING':
      return update(state, event.tmpId, () => ({ phase: 'confirming' }));
    case 'LINKED': {
      const at = locate(state, event.tmpId);
      if (!at) return withoutEffects(state);
      const item = state.byConversation[at.conversationId][at.index];
      if (item.realMessageId === event.messageId) return withoutEffects(state);
      return withoutEffects(replaceItem(state, at.conversationId, at.index, { ...item, realMessageId: event.messageId }));
    }
    case 'CONFIRMED': {
      // Mesmo sem a bolha (cancelada durante a confirmação) a mensagem existe no servidor.
      const confirmed = applyEarlyStatus(event.message, state.earlyStatusById);
      const removed = remove(state, event.tmpId);
      let next = removed.state;
      if (event.message.id in next.earlyStatusById) {
        // Consumido na troca: um reenvio posterior da mesma mensagem não herda status velho.
        const earlyStatusById = { ...next.earlyStatusById };
        delete earlyStatusById[event.message.id];
        next = { ...next, earlyStatusById };
      }
      return { state: next, revoke: removed.revoke, confirmed };
    }
    case 'FAILED': {
      const { kind } = event;
      if (kind === 'canceled') return remove(state, event.tmpId);
      return update(state, event.tmpId, () => failurePatch(kind));
    }
    case 'CANCELED':
      return remove(state, event.tmpId);
    case 'RETRY':
      return update(state, event.tmpId, (i) => {
        // `network` retoma de onde parou; `session` só reconfirma; `rejected` só descarta.
        if (i.error === 'network') return { error: null };
        if (i.error === 'session') return { phase: 'confirming', error: null };
        return null;
      });
    case 'WS_STATUS':
      return withoutEffects({
        ...state,
        earlyStatusById: { ...state.earlyStatusById, [event.messageId]: { status: event.status, at: event.at } },
      });
    case 'PRUNE': {
      const kept = Object.entries(state.earlyStatusById).filter(([, e]) => event.now - e.at < EARLY_STATUS_TTL_MS);
      if (kept.length === Object.keys(state.earlyStatusById).length) return withoutEffects(state);
      return withoutEffects({ ...state, earlyStatusById: Object.fromEntries(kept) });
    }
  }
}
