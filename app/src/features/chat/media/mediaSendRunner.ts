import { chatService } from '@/services/chat.service';
import { mediaService } from '@/services/media.service';
import { apiMessageToFrontend, type ChatMessageApiDto } from '@/types/chat.api.types';
import type { MediaUploadPurpose, UploadStatusDto } from '@/types/media.api.types';
import type { ChatMessage, MessageStatus } from '../types';
import { isUploadGone, uploadInParts, UploadAbortedError, type UploadSessionRef } from './chunkedUpload';
import type { AttachmentClassification } from './mediaPolicy';
import {
  failureKind,
  initialOutgoingMediaState,
  reduceOutgoingMedia,
  shouldReportProgress,
  type OutgoingMediaEvent,
  type OutgoingMediaState,
  type OutgoingMediaTransition,
  type ReportedProgress,
  type UploadFailureKind,
} from './outgoingMediaState';

/**
 * Orquestra o envio de mídia do painel (design §14; MEDIA-07/08/15/19/26): bolha otimista,
 * upload em partes, confirmação e as decisões por tipo de falha. Criado uma vez pelo
 * `OutgoingMediaProvider`, no layout autenticado: sair da tela do chat não cancela nada. As
 * transições são do redutor (`outgoingMediaState`); aqui ficam só os efeitos (HTTP, `blob:`,
 * timers). O redutor roda aqui, uma vez por evento, sobre o estado mais recente: os efeitos que
 * ele devolve (`revoke`, `confirmed`) precisam sair na hora — no `dispatch` do `useReducer`
 * rodariam duas vezes (StrictMode) ou só no render.
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

/**
 * Mensagem real (tipo final, status antecipado aplicado) para a página inserir — com
 * `setMessages` funcional e sem duplicar se o id já estiver na lista. Chega também quando a
 * bolha foi cancelada tarde demais: a mensagem já existe no servidor.
 */
export type MediaConfirmedListener = (conversationId: string, message: ChatMessage) => void;

export interface MediaSendRunnerOptions {
  /** Estado novo das bolhas; só é chamado quando o estado muda. */
  commit: (state: OutgoingMediaState) => void;
  onConfirmed: MediaConfirmedListener;
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
  /** A confirmação já foi pedida: o servidor pode ter gravado a mensagem sem a resposta chegar. */
  confirmSent: boolean;
  /** A mensagem real já foi entregue à página (não entrega de novo). */
  settled: boolean;
  /** Último progresso despachado (limite de frequência). */
  reported?: ReportedProgress;
  /** Acorda o item parado em `network`/`session`. */
  resume?: () => void;
  /** Geração do runner na criação: a troca de conta invalida tudo o que é anterior. */
  generation: number;
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

/** `POST /messages/:id/retry` (202) de mensagem que falhou no servidor. */
export async function retryServerMessage(message: ChatMessage): Promise<ChatMessage> {
  return apiMessageToFrontend(await chatService.retryMessage(message.id));
}

export function createMediaSendRunner({ commit, onConfirmed }: MediaSendRunnerOptions) {
  let current = initialOutgoingMediaState;
  let disposed = false;
  let generation = 0;
  const jobs = new Map<string, SendJob>();
  /** Fim da fila de cada conversa: conversas diferentes andam em paralelo. */
  const queues = new Map<string, Promise<void>>();
  /** Esperas em segundo plano (cancelamento tardio); abortadas na troca de conta. */
  let background = new AbortController();

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
  /** Ainda da conta atual — vale também para bolha já cancelada (a mensagem pode ter saído). */
  const isCurrent = (job: SendJob) => !disposed && job.generation === generation;

  function reportProgress(job: SendJob, progress: number) {
    const now = Date.now();
    if (!shouldReportProgress(job.reported, progress, now)) return;
    job.reported = { progress, at: now };
    dispatch({ type: 'PROGRESS', tmpId: job.tmpId, progress });
  }

  async function upload(job: SendJob): Promise<string> {
    const { tmpId } = job;
    job.reported = undefined;
    const base = {
      file: job.file,
      fileName: job.file.name,
      purpose: job.purpose,
      declaredMimeType: job.file.type || undefined,
      client: mediaService,
      signal: job.controller.signal,
      onProgress: (progress: number) => reportProgress(job, progress),
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

  function requestConfirmation(job: SendJob, uploadId: string): Promise<ChatMessageApiDto> {
    job.confirmSent = true;
    return chatService.sendMediaMessage(job.conversationId, {
      uploadId,
      caption: job.caption,
      quotedMessageId: job.quotedMessageId,
    });
  }

  /** `UPLOAD_IN_PROGRESS` → reconfirma a cada 2 s por até ~30 s (a confirmação é idempotente). */
  async function confirm(job: SendJob, uploadId: string): Promise<ChatMessageApiDto> {
    const startedAt = Date.now();
    for (;;) {
      try {
        return await requestConfirmation(job, uploadId);
      } catch (error) {
        const expired = Date.now() - startedAt >= CONFIRM_POLL_WINDOW_MS;
        if (kindOf(error, job, 'confirm') !== 'in_progress' || expired) throw error;
        dispatch({ type: 'FAILED', tmpId: job.tmpId, kind: 'in_progress' });
        await sleep(CONFIRM_POLL_INTERVAL_MS, job.controller.signal);
        if (!isActive(job)) throw error;
      }
    }
  }

  /**
   * A confirmação pode ter gravado a mensagem sem a resposta chegar (rede, 5xx, timeout). Antes
   * de reconfirmar, descartar ou subir de novo, o `GET` do upload diz: `CONSUMED` → reconfirma,
   * que é idempotente (200 com a mesma mensagem). `null` = não virou mensagem, ou não deu para
   * saber — o fluxo normal segue. `status` já consultado evita um `GET` repetido.
   */
  async function recoverConsumed(
    job: SendJob,
    uploadId: string,
    status?: UploadStatusDto | null,
  ): Promise<ChatMessageApiDto | null> {
    const upload = status !== undefined ? status : await mediaService.getUpload(uploadId).catch(() => null);
    if (upload?.state !== 'CONSUMED') return null;
    // Se a lista da página já tem a mensagem (resync), a bolha sai da sobreposição agora.
    if (upload.messageId) dispatch({ type: 'LINKED', tmpId: job.tmpId, messageId: upload.messageId });
    return requestConfirmation(job, uploadId).catch(() => null);
  }

  function finish(job: SendJob, dto: ChatMessageApiDto) {
    if (job.settled) return;
    job.settled = true;
    if (jobs.get(job.tmpId) === job) jobs.delete(job.tmpId);
    const { confirmed } = dispatch({ type: 'CONFIRMED', tmpId: job.tmpId, message: apiMessageToFrontend(dto) });
    if (confirmed) onConfirmed(job.conversationId, confirmed);
  }

  /** Leva o item até confirmar, ser descartado ou recusado; parado em erro, segura a fila. */
  async function run(job: SendJob): Promise<void> {
    let step: SendStep = 'upload';
    let restarts = 0;
    while (isActive(job)) {
      let dto: ChatMessageApiDto | null;
      try {
        const uploadId = step === 'confirm' && job.session ? job.session.uploadId : await upload(job);
        step = 'confirm';
        dispatch({ type: 'CONFIRMING', tmpId: job.tmpId });
        dto = await confirm(job, uploadId);
      } catch (error) {
        if (!isActive(job)) return;
        let kind = kindOf(error, job, step);
        dto = step === 'confirm' && job.session ? await recoverConsumed(job, job.session.uploadId) : null;
        if (!isActive(job)) return; // descartado durante a consulta: o `drop` resolve
        if (!dto) {
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
      }
      // Fora do `try`: erro do `onConfirmed` da página não pode virar falha de envio. Bolha
      // cancelada durante a confirmação também chega: a mensagem já existe no servidor.
      if (isCurrent(job)) finish(job, dto);
      return;
    }
  }

  /**
   * Cancelar ou descartar depois de pedir a confirmação: a mensagem pode já existir. Consulta o
   * upload antes de apagar — `CONSUMED` → mostra a mensagem real em vez de sumir com ela; aberto
   * ou em consumo → `DELETE` (em consumo responde 409 `UPLOAD_IN_PROGRESS` e o consumo decide) e
   * confere de novo até virar mensagem ou sumir. Melhor esforço, com prazo.
   */
  async function settleLateCancel(job: SendJob, uploadId: string): Promise<void> {
    const deadline = Date.now() + CONFIRM_POLL_WINDOW_MS;
    const { signal } = background;
    for (;;) {
      const status = await mediaService.getUpload(uploadId).catch(() => null);
      if (!isCurrent(job) || job.settled) return;
      // 404 (descartado ou expirado) ou sem rede: nada mais a fazer — o TTL limpa o resto.
      if (!status) return;
      if (status.state === 'CONSUMED') {
        const dto = await recoverConsumed(job, uploadId, status);
        if (dto && isCurrent(job)) finish(job, dto);
        return;
      }
      await mediaService.cancelUpload(uploadId).catch(ignore);
      if (Date.now() >= deadline || signal.aborted) return;
      await sleep(CONFIRM_POLL_INTERVAL_MS, signal);
      if (signal.aborted) return;
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

  /** Cria as bolhas e envia em sequência na conversa (upload i → confirmação i → i+1). */
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
        confirmSent: false,
        settled: false,
        generation,
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

  /** Cancelar/descartar: aborta, remove a bolha e libera o upload no servidor (melhor esforço). */
  function drop(tmpId: string) {
    const job = jobs.get(tmpId);
    jobs.delete(tmpId);
    dispatch({ type: 'CANCELED', tmpId });
    if (!job) return;
    job.controller.abort();
    job.resume?.();
    const uploadId = job.session?.uploadId;
    // Dentro do `uploadInParts`, o próprio abort apaga o upload.
    if (!uploadId || job.uploading) return;
    if (job.confirmSent) void settleLateCancel(job, uploadId);
    else mediaService.cancelUpload(uploadId).catch(ignore);
  }

  /** "Tentar de novo" de bolha com erro `network` (retoma) ou `session` (reconfirma). */
  function retry(tmpId: string) {
    const job = jobs.get(tmpId);
    const resume = job?.resume;
    if (!job || !resume) return;
    job.resume = undefined;
    dispatch({ type: 'RETRY', tmpId });
    resume();
  }

  /** Status do WS para id que a página ainda NÃO tem na lista (chegou antes do 202). */
  function onWsStatus(messageId: string, status: MessageStatus) {
    // Sem envio em andamento nenhum 202 está por vir: guardar seria só re-render à toa.
    if (jobs.size === 0) return;
    dispatch({ type: 'WS_STATUS', messageId, status, at: Date.now() });
  }

  /**
   * Aborta tudo e zera as bolhas (revoga os `blob:`). Com `releaseUploads`, apaga no servidor os
   * uploads fora do `uploadInParts` (parados ou confirmando) — só enquanto o token ainda é da
   * conta dona; na desmontagem ele pode já ter saído.
   */
  function abortAll(releaseUploads: boolean) {
    generation += 1;
    background.abort();
    background = new AbortController();
    jobs.forEach((job) => {
      job.controller.abort();
      job.resume?.();
      if (releaseUploads && job.session && !job.uploading) {
        mediaService.cancelUpload(job.session.uploadId).catch(ignore);
      }
    });
    jobs.clear();
    queues.clear();
    Object.values(current.byConversation)
      .flat()
      .forEach((item) => {
        if (item.message.mediaUrl?.startsWith('blob:')) URL.revokeObjectURL(item.message.mediaUrl);
      });
    if (current !== initialOutgoingMediaState) {
      current = initialOutgoingMediaState;
      commit(current);
    }
  }

  /** Troca de conta (`mediaAccountScope`): nada da conta anterior continua. */
  function reset() {
    abortAll(true);
  }

  /** Liga o `PRUNE` periódico; o retorno aborta tudo e revoga os `blob:` (desmontagem). */
  function start(): () => void {
    disposed = false;
    const timer = setInterval(() => dispatch({ type: 'PRUNE', now: Date.now() }), PRUNE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      abortAll(false);
      disposed = true;
    };
  }

  return { enqueue, cancel: drop, discard: drop, retry, onWsStatus, reset, start };
}

export type MediaSendRunner = ReturnType<typeof createMediaSendRunner>;
