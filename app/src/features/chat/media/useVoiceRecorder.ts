/**
 * Gravador de voz no navegador (design §14, "Gravador"; spec P1 Voz e P2 Pausar).
 *
 * Adaptador das APIs do navegador sobre `voiceRecorderReducer`: microfone, `MediaRecorder`,
 * cronômetro, ondas e pré-escuta. Toda regra de transição está no redutor (testado); aqui só se
 * despacham eventos e se liberam recursos — por isso sem teste próprio.
 *
 * Limpeza sempre (enviar, descartar, rascunho, desmontar): `track.stop()`, `AudioContext.close()`,
 * cancelar quadro e intervalo, revogar URLs.
 */
import { useEffect, useRef, useState } from 'react';
import { extensionForRecorderMime, pickRecorderMimeType } from './pickRecorderMimeType';
import {
  errorKindFromException,
  initialVoiceRecorderState,
  voiceRecorderReducer,
  type MicrophoneErrorKind,
  type VoiceRecorderEvent,
  type VoiceRecorderState,
} from './voiceRecorderMachine';

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
const AUDIO_BITS_PER_SECOND = 64_000;
const TIMESLICE_MS = 250;
/** Cadência do cronômetro e das ondas: re-render ~10×/s gravando, nunca por quadro. */
const METER_INTERVAL_MS = 100;
const LEVEL_BARS = 48;
/** Curva raiz sobre o RMS: fala baixa ainda aparece, fala alta satura perto de 1. */
const LEVEL_GAIN = 1.8;
/** Teto de espera por `dataavailable`/`stop`: navegador que não dispara não trava a barra. */
const RECORDER_EVENT_TIMEOUT_MS = 1500;

export interface UseVoiceRecorderOptions {
  /** Duração máxima gravada; ao atingir, pausa sozinho (sem enviar). */
  maxSeconds: number;
  /** Falha ao abrir o microfone, com a causa específica para o aviso (MEDIA-14). */
  onError?: (kind: MicrophoneErrorKind) => void;
}

export interface VoiceRecorderControls {
  /** Pede o microfone e grava (parte de `idle`/`error`). */
  start: () => Promise<void>;
  /** Pausa e monta a pré-escuta do que já foi gravado. */
  pause: () => Promise<void>;
  /** Continua no mesmo áudio; a pré-escuta anterior é revogada. */
  resume: () => void;
  /** Encerra e devolve o áudio; `null` se curto demais (estado traz `notice: 'tooShort'`). */
  stop: () => Promise<File | null>;
  discard: () => void;
  /** Saiu da conversa: encerra, libera o microfone e guarda o áudio (só enviar/descartar). */
  toDraft: () => Promise<void>;
  /** O `<audio>` da pré-escuta falhou: tocar fica desabilitado nesta gravação. */
  markPreviewFailed: () => void;
}

export interface UseVoiceRecorderResult extends VoiceRecorderControls {
  state: VoiceRecorderState;
  /** Até 48 níveis 0–1, o mais recente por último. */
  levels: number[];
  /** `blob:` da pré-escuta (pausado ou rascunho). */
  previewUrl: string | null;
}

interface Capture {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  audioContext: AudioContext | null;
  /** Nível 0–1 do instante; `null` enquanto (ou se) as ondas não estão disponíveis. */
  meter: (() => number) | null;
}

export function useVoiceRecorder(options: UseVoiceRecorderOptions): UseVoiceRecorderResult {
  const [state, setState] = useState(initialVoiceRecorderState);
  const [levels, setLevels] = useState<number[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  // Criado uma vez: métodos estáveis e sem dependências de render.
  const [controller] = useState(() =>
    createVoiceRecorderController({
      onState: setState,
      onLevels: setLevels,
      onPreviewUrl: setPreviewUrl,
      options: () => optionsRef.current,
    }),
  );
  useEffect(() => controller.dispose, [controller]);
  return { state, levels, previewUrl, ...controller.controls };
}

interface ControllerDeps {
  onState: (state: VoiceRecorderState) => void;
  onLevels: (levels: number[]) => void;
  onPreviewUrl: (url: string | null) => void;
  options: () => UseVoiceRecorderOptions;
}

function createVoiceRecorderController(deps: ControllerDeps) {
  // Espelho do estado do React: o redutor é puro, então aplicar os mesmos eventos na mesma
  // ordem dá o mesmo resultado — e os métodos leem o estado atual sem esperar o render.
  let state = initialVoiceRecorderState;
  let capture: Capture | null = null;
  /** Invalida o pedido de microfone em andamento (descartar, trocar de conversa, desmontar). */
  let requestId = 0;
  let elapsedMs = 0;
  let lastTickAt: number | null = null;
  let tickTimer: number | null = null;
  let frame: number | null = null;
  let peak = 0;
  let levels: number[] = [];
  let previewUrl: string | null = null;

  /** Aplica o evento; `false` = transição inválida (nada mudou). */
  const send = (event: VoiceRecorderEvent): boolean => {
    const next = voiceRecorderReducer(state, event);
    if (next === state) return false;
    state = next;
    deps.onState(next);
    return true;
  };

  const maxMs = () => Math.max(0, deps.options().maxSeconds * 1000);

  /** Manda o tempo gravado desde o último tique, sem passar do máximo. */
  const flushTick = () => {
    if (lastTickAt === null) return;
    const now = performance.now();
    const ms = Math.min(now - lastTickAt, maxMs() - elapsedMs);
    lastTickAt = now;
    if (ms <= 0) return;
    elapsedMs += ms;
    send({ type: 'TICK', ms });
  };

  const setLevels = (next: number[]) => {
    levels = next;
    deps.onLevels(next);
  };

  // Amostra por quadro, mas só guarda o pico: o estado muda no intervalo, não aqui.
  const sampleLevel = () => {
    if (capture?.meter) peak = Math.max(peak, capture.meter());
    frame = requestAnimationFrame(sampleLevel);
  };

  const onInterval = () => {
    flushTick();
    if (capture?.meter) {
      setLevels([...levels.slice(1 - LEVEL_BARS), peak]);
      peak = 0;
    }
    if (elapsedMs >= maxMs()) reachMax();
  };

  const startMeters = () => {
    stopMeters();
    lastTickAt = performance.now();
    peak = 0;
    tickTimer = window.setInterval(onInterval, METER_INTERVAL_MS);
    frame = requestAnimationFrame(sampleLevel);
  };

  /** Para cronômetro e ondas mandando antes o trecho desde o último tique. */
  const stopMeters = () => {
    flushTick();
    if (tickTimer !== null) window.clearInterval(tickTimer);
    if (frame !== null) cancelAnimationFrame(frame);
    tickTimer = null;
    frame = null;
    lastTickAt = null;
  };

  const revokePreview = () => {
    if (previewUrl === null) return;
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    deps.onPreviewUrl(null);
  };

  const showPreview = (target: Capture) => {
    revokePreview();
    if (target.chunks.length === 0) {
      send({ type: 'PREVIEW_FAILED' });
      return;
    }
    previewUrl = URL.createObjectURL(new Blob(target.chunks, { type: mimeOf(target) }));
    deps.onPreviewUrl(previewUrl);
  };

  /** Libera tudo e zera o hook (enviar, descartar, desmontar). Não despacha transição. */
  const teardown = () => {
    requestId++;
    stopMeters();
    if (capture) {
      void finishCapture(capture);
      capture = null;
    }
    revokePreview();
    elapsedMs = 0;
    if (levels.length > 0) setLevels([]);
  };

  /** Pausa o gravador e monta a pré-escuta com tudo o que já foi gravado. */
  const pauseCapture = async () => {
    const target = capture;
    if (!target || target.recorder.state !== 'recording') return;
    target.recorder.pause();
    const flushed = nextRecorderEvent(target.recorder, 'dataavailable');
    try {
      target.recorder.requestData();
      await flushed;
    } catch {
      // Sem `requestData`: a pré-escuta usa as fatias que já chegaram.
    }
    // Retomou, descartou ou saiu da conversa enquanto esperava: esta pré-escuta não vale mais.
    if (capture === target && state.status === 'paused') showPreview(target);
  };

  const reachMax = () => {
    stopMeters();
    if (send({ type: 'MAX_REACHED' })) void pauseCapture();
  };

  const start = async () => {
    if (!send({ type: 'REQUEST' })) return;
    const id = ++requestId;
    const fail = (kind: MicrophoneErrorKind) => {
      if (id !== requestId) return;
      send({ type: 'DENIED', errorKind: kind });
      deps.options().onError?.(kind);
    };
    // Fora de HTTPS o navegador nem expõe `mediaDevices`.
    if (!navigator.mediaDevices?.getUserMedia) return fail('insecure');
    if (typeof MediaRecorder === 'undefined') return fail('unsupported');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
    } catch (err) {
      return fail(errorKindFromException(err));
    }
    // Permissão chegou tarde (descartou, trocou de conversa ou desmontou): só solta o microfone.
    if (id !== requestId) {
      stopTracks(stream);
      return;
    }

    let next: Capture;
    try {
      next = openCapture(stream);
    } catch (err) {
      stopTracks(stream);
      return fail(errorKindFromException(err));
    }
    capture = next;
    elapsedMs = 0;
    send({ type: 'GRANTED' });
    startMeters();
    attachMeter(next);
  };

  const pause = async () => {
    if (state.status !== 'recording') return;
    stopMeters();
    send({ type: 'PAUSE' });
    await pauseCapture();
  };

  const resume = () => {
    const target = capture;
    if (!target || !send({ type: 'RESUME' })) return;
    revokePreview();
    try {
      target.recorder.resume();
    } catch {
      // Gravador já inativo (ex.: microfone desconectado): o envio usa o que foi gravado.
    }
    startMeters();
  };

  const stop = async (): Promise<File | null> => {
    const target = capture;
    stopMeters();
    if (!target || !send({ type: 'SEND' })) return null;
    // Curta demais: o redutor já voltou a `idle` com o aviso `tooShort`.
    if (state.status !== 'sending') {
      teardown();
      return null;
    }
    await finishCapture(target);
    if (capture !== target) return null; // descartado ou desmontado enquanto encerrava
    const mime = mimeOf(target);
    const file =
      target.chunks.length > 0
        ? new File(target.chunks, `voz-${Date.now()}.${extensionForRecorderMime(mime)}`, { type: mime })
        : null;
    teardown();
    send({ type: 'SENT' });
    return file;
  };

  const discard = () => {
    const { status } = state;
    if (status === 'sending') return; // `stop()` já está encerrando
    teardown();
    send({ type: status === 'requesting' || status === 'error' ? 'RESET' : 'DISCARD' });
  };

  const toDraft = async () => {
    if (state.status === 'requesting') {
      // O redutor ignora sair da conversa pedindo permissão: invalida o pedido e volta ao início.
      requestId++;
      send({ type: 'RESET' });
      return;
    }
    const target = capture;
    stopMeters();
    if (!target || !send({ type: 'LEAVE_CONVERSATION' })) return;
    await finishCapture(target);
    if (capture === target && state.status === 'draft') showPreview(target);
  };

  const markPreviewFailed = () => {
    send({ type: 'PREVIEW_FAILED' });
  };

  const controls: VoiceRecorderControls = { start, pause, resume, stop, discard, toDraft, markPreviewFailed };
  return { controls, dispose: teardown };
}

function stopTracks(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

/** Cria e inicia o gravador; lança se o navegador recusar o formato ou o fluxo. */
function openCapture(stream: MediaStream): Capture {
  const mimeType = pickRecorderMimeType((type) => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, {
    mimeType: mimeType || undefined,
    audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
  });
  const target: Capture = { stream, recorder, chunks: [], audioContext: null, meter: null };
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) target.chunks.push(event.data);
  });
  recorder.start(TIMESLICE_MS);
  return target;
}

/** Ondas ao vivo; falhar aqui não impede gravar. */
function attachMeter(target: Capture) {
  if (typeof AudioContext === 'undefined') return;
  try {
    const context = new AudioContext();
    target.audioContext = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(target.stream).connect(analyser);
    target.meter = createLevelMeter(analyser);
    // Safari pode criar o contexto suspenso depois do `await` da permissão. Sem esperar:
    // suspenso, o analisador só devolve silêncio, e a gravação não depende dele.
    void context.resume().catch(() => undefined);
  } catch {
    // Segue sem ondas.
  }
}

/** RMS do trecho atual, com curva raiz, limitado a 1. */
function createLevelMeter(analyser: AnalyserNode): () => number {
  const samples = new Float32Array(analyser.fftSize);
  return () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length)) * LEVEL_GAIN);
  };
}

/** Encerra o gravador e libera microfone e contexto; resolve após o último `dataavailable`. */
function finishCapture(target: Capture): Promise<void> {
  const { recorder } = target;
  let stopped = Promise.resolve();
  if (recorder.state !== 'inactive') {
    stopped = nextRecorderEvent(recorder, 'stop');
    recorder.stop();
  }
  // Os dados até o `stop()` já estão com o gravador; soltar o microfone agora apaga o indicador.
  stopTracks(target.stream);
  target.meter = null;
  const { audioContext } = target;
  if (audioContext && audioContext.state !== 'closed') void audioContext.close().catch(() => undefined);
  return stopped;
}

/** Espera o próximo evento do gravador, com teto de tempo. */
function nextRecorderEvent(recorder: MediaRecorder, type: 'dataavailable' | 'stop'): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      recorder.removeEventListener(type, done);
      resolve();
    };
    const timer = window.setTimeout(done, RECORDER_EVENT_TIMEOUT_MS);
    recorder.addEventListener(type, done);
  });
}

/** Formato real das fatias; o `mimeType` pode vir vazio antes de gravar em alguns navegadores. */
function mimeOf(target: Capture): string {
  return target.recorder.mimeType || target.chunks[0]?.type || '';
}
