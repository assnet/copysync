/**
 * Máquina de estados do gravador de voz (design §14, "Gravador"; spec P1 Voz e P2 Pausar).
 * Só o redutor puro: microfone, `MediaRecorder` e cronômetro ficam no hook, que despacha
 * os eventos abaixo e reage à mudança de `status` (parar, liberar o microfone, enviar).
 *
 * idle → requesting → recording ⇄ paused → sending → idle
 *                   ↘ error        ↘ draft (saiu da conversa: só enviar/descartar)
 *
 * Transição inválida devolve o MESMO objeto — nada lança e o React não re-renderiza.
 */

export type VoiceRecorderStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'draft' | 'sending' | 'error';

/** Causa específica mostrada ao operador (MEDIA-14). */
export type MicrophoneErrorKind = 'permission' | 'no_device' | 'in_use' | 'insecure' | 'unsupported' | 'unknown';

export type VoiceRecorderNotice = 'tooShort';

export interface VoiceRecorderState {
  status: VoiceRecorderStatus;
  /** Tempo gravado em ms, sem as pausas. */
  elapsedMs: number;
  /** Máximo atingido: pausado sem poder retomar — só ouvir, enviar ou descartar. */
  maxReached: boolean;
  /** A pré-escuta falhou neste navegador (Safari, `context.md` D2): tocar fica desabilitado. */
  previewUnsupported: boolean;
  errorKind: MicrophoneErrorKind | null;
  notice: VoiceRecorderNotice | null;
}

export type VoiceRecorderEvent =
  | { type: 'REQUEST' }
  | { type: 'GRANTED' }
  | { type: 'DENIED'; errorKind: MicrophoneErrorKind }
  /** `ms` gravados desde o tique anterior. */
  | { type: 'TICK'; ms: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'MAX_REACHED' }
  | { type: 'LEAVE_CONVERSATION' }
  | { type: 'PREVIEW_FAILED' }
  | { type: 'SEND' }
  | { type: 'SENT' }
  | { type: 'DISCARD' }
  | { type: 'RESET' };

/** Abaixo disso a gravação é descartada com aviso (spec P1, critério 6). */
export const MIN_VOICE_RECORDING_MS = 1000;

export const initialVoiceRecorderState: VoiceRecorderState = {
  status: 'idle',
  elapsedMs: 0,
  maxReached: false,
  previewUnsupported: false,
  errorKind: null,
  notice: null,
};

/** Estados com áudio gravado (há o que enviar, descartar ou ouvir). */
const hasAudio = (status: VoiceRecorderStatus) =>
  status === 'recording' || status === 'paused' || status === 'draft';

export function voiceRecorderReducer(state: VoiceRecorderState, event: VoiceRecorderEvent): VoiceRecorderState {
  const { status } = state;
  switch (event.type) {
    case 'REQUEST':
      // Começa limpo: some a causa do erro anterior e o aviso de gravação curta.
      return status === 'idle' || status === 'error' ? { ...initialVoiceRecorderState, status: 'requesting' } : state;
    case 'GRANTED':
      return status === 'requesting' ? { ...initialVoiceRecorderState, status: 'recording' } : state;
    case 'DENIED':
      return status === 'requesting'
        ? { ...initialVoiceRecorderState, status: 'error', errorKind: event.errorKind }
        : state;
    case 'TICK':
      // Só conta gravando: é isso que tira as pausas do cronômetro.
      return status === 'recording' && Number.isFinite(event.ms) && event.ms > 0
        ? { ...state, elapsedMs: state.elapsedMs + event.ms }
        : state;
    case 'PAUSE':
      return status === 'recording' ? { ...state, status: 'paused' } : state;
    case 'RESUME':
      return status === 'paused' && !state.maxReached ? { ...state, status: 'recording' } : state;
    case 'MAX_REACHED':
      // Para sozinho em pausa com pré-escuta; nunca envia automaticamente (spec P1, critério 5).
      return status === 'recording' ? { ...state, status: 'paused', maxReached: true } : state;
    case 'LEAVE_CONVERSATION':
      return status === 'recording' || status === 'paused' ? { ...state, status: 'draft' } : state;
    case 'PREVIEW_FAILED':
      // O `<audio>` pode falhar depois de retomar; a marca vale até o fim desta gravação.
      return hasAudio(status) && !state.previewUnsupported ? { ...state, previewUnsupported: true } : state;
    case 'SEND':
      if (!hasAudio(status)) return state;
      return state.elapsedMs < MIN_VOICE_RECORDING_MS
        ? { ...initialVoiceRecorderState, notice: 'tooShort' }
        : { ...state, status: 'sending' };
    case 'SENT':
      return status === 'sending' ? initialVoiceRecorderState : state;
    case 'DISCARD':
      return hasAudio(status) ? initialVoiceRecorderState : state;
    case 'RESET':
      return initialVoiceRecorderState;
  }
}

/**
 * Traduz a exceção de `getUserMedia`/`MediaRecorder` na causa mostrada ao operador.
 * `insecure` e `unsupported` não vêm daqui: o hook os detecta antes (sem `mediaDevices`
 * fora de HTTPS; sem `MediaRecorder`).
 */
export function errorKindFromException(err: unknown): MicrophoneErrorKind {
  const name = typeof err === 'object' && err !== null && 'name' in err ? err.name : undefined;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no_device';
    case 'NotReadableError':
    case 'AbortError':
      return 'in_use';
    default:
      return 'unknown';
  }
}
