import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chatService } from '@/services/chat.service';
import { mediaService } from '@/services/media.service';
import { apiMessageToFrontend, type ChatMessageApiDto } from '@/types/chat.api.types';
import type { MediaUploadPurpose } from '@/types/media.api.types';
import { chatStrings } from '../strings';
import type { ChatMessage, MessageStatus } from '../types';
import { isUploadGone, uploadInParts, UploadAbortedError, type UploadSessionRef } from './chunkedUpload';
import type { AttachmentClassification } from './mediaPolicy';
import {
  failureKind,
  initialOutgoingMediaState,
  overlayOutgoing,
  reduceOutgoingMedia,
  type OutgoingMediaEvent,
  type OutgoingMediaState,
  type OutgoingMediaTransition,
  type UploadFailureKind,
} from './outgoingMediaState';

/**
 * Orquestra o envio de mídia do painel (design §14; MEDIA-07/08/15/19/26): bolha otimista,
 * upload em partes, confirmação e as decisões por tipo de falha. Vive no `ChatPage`, então os
 * envios seguem ao trocar de conversa. As transições são do redutor (`outgoingMediaState`);
 * aqui ficam só os efeitos (HTTP, `blob:`, timers).
 */

const CONFIRM_POLL_INTERVAL_MS = 2_000;
const CONFIRM_POLL_WINDOW_MS = 30_000;
const PRUNE_INTERVAL_MS = 30_000;
/** Recomeços automáticos seguidos (`incomplete`/`not_found`) antes de parar e pedir "Tentar de novo". */
const MAX_AUTO_RESTARTS = 3;

export interface OutgoingMediaInput {
  file: File;
  /** Já aparada; vazia = sem legenda. */
  caption?: string;
  /** `classifyAttachment` para anexos; `'voice'` para a nota de voz do gravador. */
  classification: AttachmentClassification | 'voice';
  /** Só o do 1º item do lote é usado. */
  quotedMessageId?: string;
}

export interface UseOutgoingMediaOptions {
  /**
   * Mensagem real (tipo final, status antecipado aplicado) para a página inserir — com
   * `setMessages` funcional e sem duplicar se o id já estiver na lista. Chega também quando a
   * bolha foi cancelada durante a confirmação: a mensagem já existe no servidor.
   */
  onConfirmed: (conversationId: string, message: ChatMessage) => void;
}

export interface OutgoingMedia {
  /** Cria as bolhas e envia em sequência na conversa (upload i → confirmação i → i+1). */
  enqueue: (conversationId: string, items: OutgoingMediaInput[]) => void;
  /** Aborta, apaga o upload no servidor (melhor esforço) e remove a bolha. */
  cancel: (tmpId: string) => void;
  /** "Tentar de novo" de bolha com erro `network` (retoma) ou `session` (reconfirma). */
  retry: (tmpId: string) => void;
  /** Remove bolha com erro — mesmo efeito do `cancel`. */
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
  /** Lista a renderizar: servidor + bolhas desta conversa ao fim. */
  overlay: (conversationId: string, serverMessages: ChatMessage[]) => ChatMessage[];
}

interface SendJob {
  tmpId: string;
  conversationId: string;
  /** Retido enquanto reenviável: `not_found` sobe de novo daqui. */
  file: File;
  purpose: MediaUploadPurpose;
  caption?: string;
  quotedMessageId?: string;
  controller: AbortController;
  /** Retomada (`incomplete`, rede) exige id e tamanho de parte da sessão original. */
  session?: UploadSessionRef;
  /** Dentro do `uploadInParts`, o próprio abort apaga o upload. */
  uploading: boolean;
  /** Acorda o item parado em `network`/`session`. */
  resume?: () => void;
}

type SendStep = 'upload' | 'confirm';

const ignore = () => undefined;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

function kindOf(error: unknown, job: SendJob, step: SendStep): UploadFailureKind {
  const aborted = error instanceof UploadAbortedError || job.controller.signal.aborted;
  // Nas rotas de upload, 404 = sessão expirada/sumiu. Na confirmação decide o `code`
  // (404 de conversa inexistente não pode virar novo upload).
  if (!aborted && step === 'upload' && isUploadGone(error)) return 'not_found';
  return failureKind(error as { status?: number; code?: string } | null, aborted);
}

async function retryServerMessage(message: ChatMessage): Promise<ChatMessage> {
  return apiMessageToFrontend(await chatService.retryMessage(message.id));
}

/**
 * Parte imperativa, criada uma vez por montagem. O redutor roda aqui, uma vez por evento, sobre
 * o estado mais recente: os efeitos que ele devolve (`revoke`, `confirmed`) precisam sair na
 * hora — no `dispatch` do `useReducer` rodariam duas vezes (StrictMode) ou só no render.
 */
function createMediaSendRunner(
  commit: (state: OutgoingMediaState) => void,
  onConfirmed: UseOutgoingMediaOptions['onConfirmed'],
) {
  let current = initialOutgoingMediaState;
  let disposed = false;
  const jobs = new Map<string, SendJob>();
  /** Fim da fila de cada conversa: conversas diferentes andam em paralelo. */
  const queues = new Map<string, Promise<void>>();

  function dispatch(event: OutgoingMediaEvent): OutgoingMediaTransition {
    const transition = reduceOutgoingMedia(current, event);
    if (transition.state !== current) {
      current = transition.state;
      commit(current);
    }
    transition.revoke.forEach((url) => URL.revokeObjectURL(url));
    return transition;
  }

  const isActive = (job: SendJob) => !disposed && jobs.get(job.tmpId) === job;

  async function upload(job: SendJob): Promise<string> {
    const { tmpId } = job;
    const base = {
      file: job.file,
      fileName: job.file.name,
      purpose: job.purpose,
      declaredMimeType: job.file.type || undefined,
      client: mediaService,
      signal: job.controller.signal,
      onProgress: (progress: number) => dispatch({ type: 'PROGRESS', tmpId, progress }),
    };
    job.uploading = true;
    try {
      const { uploadId } = job.session
        ? await uploadInParts({
            ...base,
            existingUploadId: job.session.uploadId,
            chunkSizeBytes: job.session.chunkSizeBytes,
          })
        : await uploadInParts({
            ...base,
            onUploadCreated: (session) => {
              job.session = session;
              dispatch({ type: 'UPLOAD_STARTED', tmpId, uploadId: session.uploadId });
            },
          });
      return uploadId;
    } finally {
      job.uploading = false;
    }
  }

  /** `UPLOAD_IN_PROGRESS` → reconfirma a cada 2 s por até ~30 s (a confirmação é idempotente). */
  async function confirm(job: SendJob, uploadId: string): Promise<ChatMessageApiDto> {
    const startedAt = Date.now();
    for (;;) {
      try {
        return await chatService.sendMediaMessage(job.conversationId, {
          uploadId,
          caption: job.caption,
          quotedMessageId: job.quotedMessageId,
        });
      } catch (error) {
        const expired = Date.now() - startedAt >= CONFIRM_POLL_WINDOW_MS;
        if (kindOf(error, job, 'confirm') !== 'in_progress' || expired) throw error;
        dispatch({ type: 'FAILED', tmpId: job.tmpId, kind: 'in_progress' });
        await sleep(CONFIRM_POLL_INTERVAL_MS, job.controller.signal);
        if (!isActive(job)) throw error;
      }
    }
  }

  function finish(job: SendJob, dto: ChatMessageApiDto) {
    if (jobs.get(job.tmpId) === job) jobs.delete(job.tmpId);
    const { confirmed } = dispatch({ type: 'CONFIRMED', tmpId: job.tmpId, message: apiMessageToFrontend(dto) });
    if (confirmed) onConfirmed(job.conversationId, confirmed);
  }

  /** Leva o item até confirmar, ser descartado ou recusado; parado em erro, segura a fila. */
  async function run(job: SendJob): Promise<void> {
    let step: SendStep = 'upload';
    let restarts = 0;
    while (isActive(job)) {
      let dto: ChatMessageApiDto;
      try {
        const uploadId = step === 'confirm' && job.session ? job.session.uploadId : await upload(job);
        step = 'confirm';
        dispatch({ type: 'CONFIRMING', tmpId: job.tmpId });
        dto = await confirm(job, uploadId);
      } catch (error) {
        if (!isActive(job)) return;
        let kind = kindOf(error, job, step);
        // Reconfirmação esgotada ou recomeços demais: para e espera "Tentar de novo".
        if (kind === 'in_progress') kind = 'network';
        if ((kind === 'incomplete' || kind === 'not_found') && ++restarts > MAX_AUTO_RESTARTS) kind = 'network';
        dispatch({ type: 'FAILED', tmpId: job.tmpId, kind });

        if (kind === 'rejected' || kind === 'canceled') {
          // Só resta descartar: solta o `File` e libera o parcial (o `DELETE` é idempotente).
          jobs.delete(job.tmpId);
          if (job.session) mediaService.cancelUpload(job.session.uploadId).catch(ignore);
          return;
        }
        if (kind === 'not_found') job.session = undefined;
        if (kind === 'incomplete' || kind === 'not_found') {
          step = 'upload';
          continue;
        }
        // `network`/`session`: os próximos do lote esperam — manter a ordem vale mais que adiantar.
        await new Promise<void>((resolve) => {
          job.resume = resolve;
        });
        restarts = 0;
        continue;
      }
      // Fora do `try`: erro do `onConfirmed` da página não pode virar falha de envio.
      if (!disposed) finish(job, dto);
      return;
    }
  }

  function schedule(job: SendJob) {
    const { conversationId } = job;
    const tail = (queues.get(conversationId) ?? Promise.resolve())
      .then(() => run(job))
      .catch((error: unknown) => console.error('Erro no envio de mídia', error));
    queues.set(conversationId, tail);
    void tail.finally(() => {
      if (queues.get(conversationId) === tail) queues.delete(conversationId);
    });
  }

  function enqueue(conversationId: string, items: OutgoingMediaInput[]) {
    items.forEach((input, index) => {
      const tmpId = `tmp-${crypto.randomUUID()}`;
      const { file, classification } = input;
      const voice = classification === 'voice';
      const type = voice ? 'audio' : classification.kind;
      const caption = input.caption || undefined;
      const quotedMessageId = index === 0 ? input.quotedMessageId : undefined;

      const job: SendJob = {
        tmpId,
        conversationId,
        file,
        purpose: voice ? 'voice' : classification.purpose,
        caption,
        quotedMessageId,
        controller: new AbortController(),
        uploading: false,
      };
      jobs.set(tmpId, job);
      dispatch({
        type: 'ADDED',
        message: {
          id: tmpId,
          conversationId,
          type,
          direction: 'out',
          body: caption ?? null,
          mediaUrl: URL.createObjectURL(file),
          mimeType: file.type || null,
          fileName: type === 'document' ? file.name : null,
          timestamp: new Date().toISOString(),
          status: 'sending',
          quotedMessageId,
        },
      });
      schedule(job);
    });
  }

  function drop(tmpId: string) {
    const job = jobs.get(tmpId);
    jobs.delete(tmpId);
    dispatch({ type: 'CANCELED', tmpId });
    if (!job) return;
    job.controller.abort();
    job.resume?.();
    if (job.session && !job.uploading) mediaService.cancelUpload(job.session.uploadId).catch(ignore);
  }

  function retry(tmpId: string) {
    const job = jobs.get(tmpId);
    const resume = job?.resume;
    if (!job || !resume) return;
    job.resume = undefined;
    dispatch({ type: 'RETRY', tmpId });
    resume();
  }

  function onWsStatus(messageId: string, status: MessageStatus) {
    dispatch({ type: 'WS_STATUS', messageId, status, at: Date.now() });
  }

  /** Liga o `PRUNE` periódico; o retorno aborta tudo e revoga os `blob:` (desmontagem). */
  function start(): () => void {
    disposed = false;
    const timer = setInterval(() => dispatch({ type: 'PRUNE', now: Date.now() }), PRUNE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      disposed = true;
      jobs.forEach((job) => {
        job.controller.abort();
        job.resume?.();
      });
      jobs.clear();
      queues.clear();
      Object.values(current.byConversation)
        .flat()
        .forEach((item) => dispatch({ type: 'CANCELED', tmpId: item.tmpId }));
    };
  }

  return { enqueue, drop, retry, onWsStatus, start };
}

export function useOutgoingMedia({ onConfirmed }: UseOutgoingMediaOptions): OutgoingMedia {
  const [state, setState] = useState(initialOutgoingMediaState);
  const onConfirmedRef = useRef(onConfirmed);
  useEffect(() => {
    onConfirmedRef.current = onConfirmed;
  });
  const [runner] = useState(() =>
    createMediaSendRunner(setState, (conversationId, message) => onConfirmedRef.current(conversationId, message)),
  );

  useEffect(() => runner.start(), [runner]);

  // Envio que ainda pode seguir (inclui parado em `network`/`session`: sair perde o `File`).
  const hasPendingSend = useMemo(
    () => Object.values(state.byConversation).some((items) => items.some((i) => i.error !== 'rejected')),
    [state.byConversation],
  );

  useEffect(() => {
    if (!hasPendingSend) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Navegadores antigos exigem `returnValue`; os atuais mostram texto próprio.
      event.returnValue = chatStrings.upload.leavePageWarning;
      return chatStrings.upload.leavePageWarning;
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasPendingSend]);

  const overlay = useCallback(
    (conversationId: string, serverMessages: ChatMessage[]) =>
      overlayOutgoing(serverMessages, state.byConversation[conversationId]),
    [state.byConversation],
  );

  return useMemo(
    () => ({
      enqueue: runner.enqueue,
      cancel: runner.drop,
      retry: runner.retry,
      discard: runner.drop,
      retryServerMessage,
      onWsStatus: runner.onWsStatus,
      overlay,
    }),
    [runner, overlay],
  );
}
