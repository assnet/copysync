/**
 * Forma de onda da bolha de áudio.
 *
 * `computeWaveform` decodifica o arquivo com `AudioContext` e reduz cada bloco de amostras à
 * média do valor absoluto, normalizada para 0–1 pelo pico — o mesmo cálculo que a engine de
 * mensageria usa ao gerar a onda da nota de voz, então a bolha fica parecida com a do celular.
 *
 * Nem sempre dá para decodificar (Safari não abre Ogg/Opus; o arquivo pode estar corrompido):
 * `pseudoWaveform` gera barras suaves e determinísticas a partir de uma semente (id/URL),
 * para a bolha ter sempre a mesma cara enquanto a onda real carrega ou quando ela não vem.
 */

/** Barras exibidas na bolha. */
export const WAVEFORM_BARS = 44;

/** Ondas já calculadas, por URL — a lista remonta a bolha várias vezes e o arquivo não muda. */
const waveformCache = new Map<string, number[]>();
/** Requisições em voo, para duas bolhas com o mesmo arquivo não baixarem duas vezes. */
const inFlight = new Map<string, Promise<number[]>>();

/** Reduz amostras PCM a `bars` valores 0–1 (média absoluta por bloco, pico = 1). */
export function reduceSamples(samples: ArrayLike<number>, bars: number): number[] {
  const count = Math.max(1, Math.floor(bars));
  if (samples.length === 0) return new Array<number>(count).fill(0);
  const blockSize = Math.max(1, Math.floor(samples.length / count));
  const averages: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * blockSize;
    const end = Math.min(samples.length, start + blockSize);
    let sum = 0;
    for (let j = start; j < end; j++) sum += Math.abs(samples[j]);
    averages.push(end > start ? sum / (end - start) : 0);
  }
  const peak = Math.max(...averages);
  if (peak <= 0) return averages.map(() => 0);
  return averages.map((value) => value / peak);
}

type AudioContextCtor = new () => AudioContext;

function resolveAudioContext(): AudioContextCtor | null {
  const w = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Decodifica o áudio e devolve `bars` valores 0–1. Rejeita quando o navegador não decodifica
 * o formato — quem chama decide o fallback.
 */
export async function computeWaveform(buffer: ArrayBuffer, bars: number): Promise<number[]> {
  const Ctor = resolveAudioContext();
  if (!Ctor) throw new Error('AudioContext indisponível');
  const context = new Ctor();
  try {
    // Safari antigo só aceita a forma com callbacks; a Promise cobre os dois.
    const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      const result = context.decodeAudioData(buffer.slice(0), resolve, reject);
      if (result && typeof (result as Promise<AudioBuffer>).then === 'function') {
        (result as Promise<AudioBuffer>).then(resolve, reject);
      }
    });
    return reduceSamples(decoded.getChannelData(0), bars);
  } finally {
    void context.close?.().catch(() => undefined);
  }
}

/** Hash FNV-1a de 32 bits: barato e estável entre execuções. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** PRNG mulberry32 — determinístico pela semente, sem depender de `Math.random`. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Onda de aparência natural sem decodificar nada: ruído determinístico suavizado pelos vizinhos
 * e limitado a 0.25–1, para nenhuma barra sumir. Mesma semente → mesma onda, sempre.
 */
export function pseudoWaveform(seed: string, bars: number): number[] {
  const count = Math.max(1, Math.floor(bars));
  const random = mulberry32(hashSeed(seed));
  const noise = Array.from({ length: count }, () => random());
  const min = 0.25;
  return noise.map((_, i) => {
    const prev = noise[i - 1] ?? noise[i];
    const next = noise[i + 1] ?? noise[i];
    const smooth = prev * 0.25 + noise[i] * 0.5 + next * 0.25;
    return Math.min(1, min + smooth * (1 - min));
  });
}

/** Onda já conhecida para a URL (sem rede). */
export function getCachedWaveform(url: string): number[] | undefined {
  return waveformCache.get(url);
}

/**
 * Baixa o arquivo e calcula a onda, com cache por URL. Rejeita em falha de rede ou de
 * decodificação — a bolha mantém a onda provisória nesses casos.
 */
export function loadWaveform(url: string, bars: number, signal?: AbortSignal): Promise<number[]> {
  const cached = waveformCache.get(url);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(url);
  if (pending) return pending;

  const task = (async () => {
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const waveform = await computeWaveform(await response.arrayBuffer(), bars);
      waveformCache.set(url, waveform);
      return waveform;
    } finally {
      inFlight.delete(url);
    }
  })();
  inFlight.set(url, task);
  return task;
}

/** Só para testes: zera o cache entre casos. */
export function resetWaveformCache(): void {
  waveformCache.clear();
  inFlight.clear();
}
