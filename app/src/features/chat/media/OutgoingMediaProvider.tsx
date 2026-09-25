/**
 * Envio de mídia acima das rotas (design §14; MEDIA-08): montado no `AppLayout`, dentro dos
 * contextos de auth/tenant. Sair da tela do chat não cancela upload nem confirmação — a bolha
 * volta com o progresso em dia ao reabrir a conversa. Logout e troca de tenant abortam tudo
 * (`mediaAccountScope`).
 *
 * Desempenho: o estado das bolhas fica fora do React. Cada consumidor assina só o que usa —
 * o `ChatPage` lê as bolhas da conversa aberta (`useOutgoingMediaItems`), então o progresso de
 * outra conversa não re-renderiza a página.
 */
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ChatMessage, MessageStatus } from '../types';
import { chatStrings } from '../strings';
import { mediaAccountScope } from './mediaAccountScope';
import {
  createMediaSendRunner,
  retryServerMessage,
  type MediaConfirmedListener,
  type OutgoingMediaInput,
} from './mediaSendRunner';
import {
  hasPendingSend,
  initialOutgoingMediaState,
  type OutgoingMediaItem,
  type OutgoingMediaState,
} from './outgoingMediaState';

export type { OutgoingMediaInput } from './mediaSendRunner';

export interface OutgoingMedia {
  /** Cria as bolhas e envia em sequência na conversa (upload i → confirmação i → i+1). */
  enqueue: (conversationId: string, items: OutgoingMediaInput[]) => void;
  /** Aborta, libera o upload no servidor (melhor esforço) e remove a bolha. */
  cancel: (tmpId: string) => void;
  /** "Tentar de novo" de bolha com erro `network` (retoma) ou `session` (reconfirma). */
  retry: (tmpId: string) => void;
  /** Remove bolha com erro — mesmo efeito do `cancel`, inclusive o `DELETE` do upload. */
  discard: (tmpId: string) => void;
  /**
   * "Tentar de novo" de mensagem que falhou no servidor (`POST /messages/:id/retry`, 202).
   * Devolve a mensagem com o status do 202 (`sending`); o WS pode ter chegado antes com status
   * mais novo, então a página só aplica se o status atual ainda for `failed`. Rejeita com o erro
   * da API (ex.: `SESSION_NOT_CONNECTED`).
   */
  retryServerMessage: (message: ChatMessage) => Promise<ChatMessage>;
  /** Status do WS para id que a página ainda NÃO tem na lista (chegou antes do 202). */
  onWsStatus: (messageId: string, status: MessageStatus) => void;
}

interface OutgoingMediaHub {
  media: OutgoingMedia;
  subscribe: (listener: () => void) => () => void;
  getState: () => OutgoingMediaState;
  addConfirmedListener: (listener: MediaConfirmedListener) => () => void;
  /** Liga o runner; o retorno desliga (desmontagem). */
  start: () => () => void;
}

function warnBeforeLeaving(event: BeforeUnloadEvent) {
  event.preventDefault();
  // Navegadores antigos exigem `returnValue`; os atuais mostram texto próprio.
  event.returnValue = chatStrings.upload.leavePageWarning;
  return chatStrings.upload.leavePageWarning;
}

function createOutgoingMediaHub(): OutgoingMediaHub {
  let state = initialOutgoingMediaState;
  const listeners = new Set<() => void>();
  const confirmedListeners = new Set<MediaConfirmedListener>();
  let warning = false;

  // `beforeunload` só com envio que ainda pode seguir: fechar a aba perde o `File`.
  const syncLeaveWarning = () => {
    const pending = hasPendingSend(state);
    if (pending === warning) return;
    warning = pending;
    if (pending) window.addEventListener('beforeunload', warnBeforeLeaving);
    else window.removeEventListener('beforeunload', warnBeforeLeaving);
  };

  const runner = createMediaSendRunner({
    commit: (next) => {
      state = next;
      syncLeaveWarning();
      listeners.forEach((listener) => listener());
    },
    // Sem página montada ninguém escuta: ao voltar, o GET da conversa traz a mensagem.
    onConfirmed: (conversationId, message) => confirmedListeners.forEach((l) => l(conversationId, message)),
  });

  return {
    media: {
      enqueue: runner.enqueue,
      cancel: runner.cancel,
      retry: runner.retry,
      discard: runner.discard,
      retryServerMessage,
      onWsStatus: runner.onWsStatus,
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
    addConfirmedListener: (listener) => {
      confirmedListeners.add(listener);
      return () => {
        confirmedListeners.delete(listener);
      };
    },
    start: () => {
      const stop = runner.start();
      const unsubscribe = mediaAccountScope.subscribe(runner.reset);
      return () => {
        unsubscribe();
        stop();
      };
    },
  };
}

const OutgoingMediaContext = createContext<OutgoingMediaHub | null>(null);

export function OutgoingMediaProvider({ children }: { children: ReactNode }) {
  const [hub] = useState(createOutgoingMediaHub);
  useEffect(() => hub.start(), [hub]);
  return <OutgoingMediaContext.Provider value={hub}>{children}</OutgoingMediaContext.Provider>;
}

function useHub(): OutgoingMediaHub {
  const hub = useContext(OutgoingMediaContext);
  if (!hub) throw new Error('useOutgoingMedia deve ser usado dentro de OutgoingMediaProvider');
  return hub;
}

/**
 * Ações do envio (objeto estável). `onConfirmed` recebe a mensagem real do 202/200 enquanto o
 * componente estiver montado.
 */
export function useOutgoingMedia(onConfirmed?: MediaConfirmedListener): OutgoingMedia {
  const hub = useHub();
  const onConfirmedRef = useRef(onConfirmed);
  useEffect(() => {
    onConfirmedRef.current = onConfirmed;
  });
  useEffect(
    () => hub.addConfirmedListener((conversationId, message) => onConfirmedRef.current?.(conversationId, message)),
    [hub],
  );
  return hub.media;
}

/** Bolhas em envio de uma conversa; só re-renderiza quando as DESTA conversa mudam. */
export function useOutgoingMediaItems(conversationId: string | null): OutgoingMediaItem[] | undefined {
  const hub = useHub();
  return useSyncExternalStore(hub.subscribe, () =>
    conversationId ? hub.getState().byConversation[conversationId] : undefined,
  );
}
