/**
 * Gravador de voz do chat, compartilhado pela página (design §14, "Gravador"; MEDIA-11..14, 31).
 *
 * Existe para duas coisas que o composer sozinho não resolve:
 * - **Desempenho**: o hook re-renderiza a cada ~100 ms gravando. Hospedado aqui, com `children`
 *   estável vindo da página, só quem consome o contexto (o composer) re-renderiza — a lista de
 *   conversas e as mensagens não.
 * - **Rascunho por conversa**: trocar ou perder a seleção gravando (inclusive arquivamento
 *   vindo do WS) encerra, libera o microfone e guarda o áudio da conversa. Ao voltar, a barra
 *   abre em rascunho (ouvir, enviar ou descartar; sem retomar). Outra conversa grava do zero.
 *
 * O hook grava uma conversa por vez (a "dona"); os rascunhos ficam num mapa por conversa, fora
 * do hook, com `File` e URL de pré-escuta próprios.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { chatStrings } from '../strings';
import type { OutgoingMedia } from './useOutgoingMedia';
import { useVoiceRecorder } from './useVoiceRecorder';
import {
  initialVoiceRecorderState,
  MIN_VOICE_RECORDING_MS,
  type MicrophoneErrorKind,
  type VoiceRecorderState,
  type VoiceRecorderStatus,
} from './voiceRecorderMachine';

const texts = chatStrings.voice;

/** Padrão da spec (P1, critério 5) enquanto a configuração não chega. */
const DEFAULT_MAX_VOICE_SECONDS = 15 * 60;
/** Estados em que a barra ocupa a linha do composer (mesmo critério da `VoiceRecorderBar`). */
const BAR_STATUSES: ReadonlySet<VoiceRecorderStatus> = new Set(['recording', 'paused', 'draft', 'sending']);
const NO_LEVELS: number[] = [];

/** Causa específica do microfone (MEDIA-14). */
const MICROPHONE_ERROR_TEXT: Record<MicrophoneErrorKind, string> = {
  permission: texts.errors.permissionDenied,
  no_device: texts.errors.noMicrophone,
  in_use: texts.errors.microphoneBusy,
  insecure: texts.errors.insecureContext,
  unsupported: texts.errors.unsupported,
  unknown: texts.errors.generic,
};

export type VoiceNoticeSeverity = 'error' | 'warning' | 'info';

/** Áudio guardado ao sair da conversa: só ouvir, enviar ou descartar. */
interface VoiceDraft {
  file: File;
  previewUrl: string;
  /** Estado `draft` da barra, criado uma vez (referência estável entre renders). */
  state: VoiceRecorderState;
  /** Últimas ondas da gravação, exibidas paradas. */
  levels: number[];
}

/** Gravação saindo da conversa: a barra dela mostra o rascunho enquanto o áudio fecha. */
interface Detaching {
  conversationId: string;
  state: VoiceRecorderState;
  levels: number[];
}

export interface VoiceRecorderContextValue {
  /** Servidor converte nota de voz (`capabilities.voiceNotes`); `false` → microfone desabilitado. */
  available: boolean;
  /** Estado da barra na conversa aberta: rascunho guardado ou gravação em curso. */
  state: VoiceRecorderState;
  levels: number[];
  previewUrl: string | null;
  /** A barra ocupa a linha do composer nesta conversa. */
  barVisible: boolean;
  /** Esperando a permissão do microfone nesta conversa. */
  requesting: boolean;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  /**
   * Encerra e enfileira como nota de voz, citando `quotedMessageId`. `true` = enviado na
   * conversa ainda aberta (o composer limpa a resposta). Curta demais → aviso, sem envio.
   */
  send: (quotedMessageId: string | null) => Promise<boolean>;
  discard: () => Promise<void>;
  markPreviewFailed: () => void;
}

const VoiceRecorderContext = createContext<VoiceRecorderContextValue | null>(null);

/** `null` fora do provider: o composer trata como voz indisponível. */
export function useVoiceRecorderContext(): VoiceRecorderContextValue | null {
  return useContext(VoiceRecorderContext);
}

export interface VoiceRecorderProviderProps {
  /** Conversa aberta; mudar (ou `null`) gravando guarda o rascunho da anterior. */
  activeConversationId: string | null;
  available: boolean;
  /** `maxVoiceSeconds` da configuração de upload. */
  maxSeconds?: number;
  /** Fila de envio de mídia da página (`useOutgoingMedia().enqueue`). */
  enqueue: OutgoingMedia['enqueue'];
  /** Aviso ao operador (snackbar da página). */
  onNotice: (message: string, severity: VoiceNoticeSeverity) => void;
  children: ReactNode;
}

export function VoiceRecorderProvider({
  activeConversationId,
  available,
  maxSeconds = DEFAULT_MAX_VOICE_SECONDS,
  enqueue,
  onNotice,
  children,
}: VoiceRecorderProviderProps) {
  const callbacksRef = useRef({ enqueue, onNotice });
  useEffect(() => {
    callbacksRef.current = { enqueue, onNotice };
  });

  const recorder = useVoiceRecorder({
    maxSeconds,
    onError: (kind) => callbacksRef.current.onNotice(MICROPHONE_ERROR_TEXT[kind], 'error'),
  });
  // Métodos do hook são estáveis (criados uma vez); só estado, ondas e URL mudam por render.
  const {
    start: startRecording,
    pause: pauseRecording,
    resume: resumeRecording,
    stop,
    discard: discardRecording,
    toDraft,
    markPreviewFailed: markRecordingPreviewFailed,
  } = recorder;

  // Espelho do último render para os métodos assíncronos.
  const liveRef = useRef({ state: recorder.state, levels: recorder.levels });
  useEffect(() => {
    liveRef.current = { state: recorder.state, levels: recorder.levels };
  });

  const [drafts, setDrafts] = useState<ReadonlyMap<string, VoiceDraft>>(() => new Map());
  const draftsRef = useRef(drafts);
  /** Conversa dona da gravação no hook. */
  const [owner, setOwnerState] = useState<string | null>(null);
  const ownerRef = useRef<string | null>(null);
  const [detaching, setDetaching] = useState<Detaching | null>(null);
  const detachRef = useRef<Promise<void> | null>(null);
  const activeRef = useRef(activeConversationId);

  const setOwner = useCallback((conversationId: string | null) => {
    ownerRef.current = conversationId;
    setOwnerState(conversationId);
  }, []);

  /** O hook grava a conversa aberta (e não o rascunho de outra que está fechando). */
  const ownsActive = useCallback(
    () => activeRef.current !== null && ownerRef.current === activeRef.current,
    [],
  );

  const updateDrafts = useCallback((change: (current: Map<string, VoiceDraft>) => void) => {
    const next = new Map(draftsRef.current);
    change(next);
    draftsRef.current = next;
    setDrafts(next);
  }, []);

  const removeDraft = useCallback(
    (conversationId: string) => {
      const draft = draftsRef.current.get(conversationId);
      if (!draft) return;
      URL.revokeObjectURL(draft.previewUrl);
      updateDrafts((map) => map.delete(conversationId));
    },
    [updateDrafts],
  );

  /** Sai da conversa dona: encerra, solta o microfone e guarda o áudio como rascunho dela. */
  const detach = useCallback(
    (conversationId: string) => {
      if (detachRef.current) return;
      const { state: before, levels } = liveRef.current;
      if (before.status === 'sending') return; // `send()` termina e solta a dona
      if (before.status !== 'recording' && before.status !== 'paused') {
        // Pedindo permissão: invalida o pedido (o microfone é solto se a permissão chegar depois).
        if (before.status === 'requesting') void toDraft();
        setOwner(null);
        return;
      }
      setDetaching({ conversationId, state: draftState(before.elapsedMs, before.previewUnsupported), levels });
      const run = (async () => {
        try {
          await toDraft();
          // Tempo final: o render do rascunho costuma chegar antes do `stop` do gravador.
          const after = liveRef.current.state;
          const elapsedMs = Math.max(before.elapsedMs, after.status === 'draft' ? after.elapsedMs : 0);
          const previewUnsupported = before.previewUnsupported || after.previewUnsupported;
          // Tira o áudio do hook (fica livre para outra conversa). Curta demais volta `null`:
          // sai sem aviso — o operador já está em outra conversa.
          const file = await stop();
          if (!file) return;
          const draft: VoiceDraft = {
            file,
            previewUrl: URL.createObjectURL(file),
            state: draftState(elapsedMs, previewUnsupported),
            levels,
          };
          updateDrafts((map) => {
            const previous = map.get(conversationId);
            if (previous) URL.revokeObjectURL(previous.previewUrl);
            map.set(conversationId, draft);
          });
          callbacksRef.current.onNotice(texts.draftSaved, 'info');
        } finally {
          if (ownerRef.current === conversationId) setOwner(null);
          setDetaching(null);
          detachRef.current = null;
        }
      })();
      detachRef.current = run;
    },
    [setOwner, stop, toDraft, updateDrafts],
  );

  useEffect(() => {
    activeRef.current = activeConversationId;
    const current = ownerRef.current;
    if (current !== null && current !== activeConversationId) detach(current);
  }, [activeConversationId, detach]);

  // Rascunhos não sobrevivem à página; o hook solta o microfone sozinho ao desmontar.
  useEffect(
    () => () => {
      draftsRef.current.forEach((draft) => URL.revokeObjectURL(draft.previewUrl));
    },
    [],
  );

  const start = useCallback(async () => {
    const conversationId = activeRef.current;
    if (!conversationId) return;
    if (detachRef.current) await detachRef.current;
    // Trocou de conversa esperando, ou a conversa já tem rascunho (a barra dele está aberta).
    if (activeRef.current !== conversationId || draftsRef.current.has(conversationId)) return;
    if (ownerRef.current !== null && ownerRef.current !== conversationId) return;
    setOwner(conversationId);
    await startRecording();
  }, [setOwner, startRecording]);

  const pause = useCallback(() => {
    if (ownsActive()) void pauseRecording();
  }, [ownsActive, pauseRecording]);

  const resume = useCallback(() => {
    if (ownsActive()) resumeRecording();
  }, [ownsActive, resumeRecording]);

  const send = useCallback(
    async (quotedMessageId: string | null): Promise<boolean> => {
      const conversationId = activeRef.current;
      if (!conversationId) return false;
      if (detachRef.current) await detachRef.current;

      let file: File | null;
      const draft = draftsRef.current.get(conversationId);
      if (draft) {
        file = draft.file;
        removeDraft(conversationId);
      } else {
        if (ownerRef.current !== conversationId) return false;
        // O render fica no máximo um tique atrás do hook: abaixo do mínimo aqui, curta de fato.
        const elapsedBefore = liveRef.current.state.elapsedMs;
        file = await stop();
        if (ownerRef.current === conversationId) setOwner(null);
        if (!file) {
          const tooShort = elapsedBefore < MIN_VOICE_RECORDING_MS;
          callbacksRef.current.onNotice(tooShort ? texts.tooShort : texts.errors.generic, tooShort ? 'warning' : 'error');
          return false;
        }
      }

      callbacksRef.current.enqueue(conversationId, [
        { file, classification: 'voice', quotedMessageId: quotedMessageId ?? undefined },
      ]);
      return activeRef.current === conversationId;
    },
    [removeDraft, setOwner, stop],
  );

  const discard = useCallback(async () => {
    const conversationId = activeRef.current;
    if (!conversationId) return;
    if (detachRef.current) await detachRef.current;
    if (draftsRef.current.has(conversationId)) {
      removeDraft(conversationId);
      return;
    }
    if (ownerRef.current !== conversationId) return;
    discardRecording();
    setOwner(null);
  }, [discardRecording, removeDraft, setOwner]);

  const markPreviewFailed = useCallback(() => {
    const conversationId = activeRef.current;
    const draft = conversationId ? draftsRef.current.get(conversationId) : undefined;
    if (conversationId && draft) {
      if (!draft.state.previewUnsupported) {
        const state = draftState(draft.state.elapsedMs, true);
        updateDrafts((map) => map.set(conversationId, { ...draft, state }));
      }
      return;
    }
    if (ownsActive()) markRecordingPreviewFailed();
  }, [markRecordingPreviewFailed, ownsActive, updateDrafts]);

  // O que a barra da conversa aberta mostra: rascunho guardado > rascunho fechando > gravação.
  const draft = activeConversationId ? drafts.get(activeConversationId) : undefined;
  const owned = owner !== null && owner === activeConversationId;
  let state: VoiceRecorderState = initialVoiceRecorderState;
  let levels = NO_LEVELS;
  let previewUrl: string | null = null;
  if (draft) {
    ({ state, levels, previewUrl } = draft);
  } else if (detaching && detaching.conversationId === activeConversationId) {
    ({ state, levels } = detaching);
  } else if (owned) {
    ({ state, levels, previewUrl } = recorder);
  }
  const barVisible = BAR_STATUSES.has(state.status);
  const requesting = owned && state.status === 'requesting';

  const value = useMemo<VoiceRecorderContextValue>(
    () => ({
      available,
      state,
      levels,
      previewUrl,
      barVisible,
      requesting,
      start,
      pause,
      resume,
      send,
      discard,
      markPreviewFailed,
    }),
    [available, state, levels, previewUrl, barVisible, requesting, start, pause, resume, send, discard, markPreviewFailed],
  );

  return <VoiceRecorderContext.Provider value={value}>{children}</VoiceRecorderContext.Provider>;
}

function draftState(elapsedMs: number, previewUnsupported: boolean): VoiceRecorderState {
  return { ...initialVoiceRecorderState, status: 'draft', elapsedMs, previewUnsupported };
}
