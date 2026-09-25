/** Metadados de um arquivo de mídia lidos pelo `ffprobe`. */
export interface MediaProbe {
  /** Duração em segundos inteiros (arredondada); `null` quando o contêiner não informa. */
  durationSeconds: number | null;
  /** Largura de exibição — já trocada com a altura quando o vídeo está girado 90/270°. */
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  pixelFormat: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
}

/** Saída do `ffprobe` que não é o JSON esperado. Quem chama traduz para o erro de processamento. */
export class InvalidProbeOutputError extends Error {
  readonly code = 'INVALID_PROBE_OUTPUT';

  constructor(message = 'Saída do ffprobe inválida') {
    super(message);
    this.name = 'InvalidProbeOutputError';
  }
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `ffprobe` escreve números como número ou como texto (`"2.600000"`, `"90"`); `"N/A"` vira `null`. */
function toNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function toDimension(value: unknown): number | null {
  const n = toNumber(value);
  return n !== null && n > 0 ? n : null;
}

/** Rotação do vídeo: matriz de exibição (`side_data_list`, ffmpeg novo) ou tag `rotate` (contêineres antigos). */
function rotationOf(stream: Json): number | null {
  const sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  for (const item of sideData) {
    const rotation = isObject(item) ? toNumber(item.rotation) : null;
    if (rotation !== null) return rotation;
  }
  return isObject(stream.tags) ? toNumber(stream.tags.rotate) : null;
}

/** Capa embutida de áudio (mp3/m4a): o ffprobe a lista como stream de vídeo (`mjpeg`/`png`). */
function isAttachedPicture(stream: Json): boolean {
  return isObject(stream.disposition) && toNumber(stream.disposition.attached_pic) === 1;
}

function isQuarterTurn(rotation: number | null): boolean {
  if (rotation === null) return false;
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized === 90 || normalized === 270;
}

/**
 * Lê a saída JSON de
 * `ffprobe -show_entries format=duration:stream=codec_type,codec_name,pix_fmt,width,height:stream_side_data=rotation:stream_tags=rotate:stream_disposition=attached_pic -of json`.
 * Considera só a primeira stream de vídeo e a primeira de áudio; capa embutida (`attached_pic`) não conta como vídeo.
 * @throws {InvalidProbeOutputError} quando o texto não é um objeto JSON.
 */
export function parseProbeOutput(json: string): MediaProbe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidProbeOutputError();
  }
  if (!isObject(parsed)) throw new InvalidProbeOutputError();

  const streams = (Array.isArray(parsed.streams) ? parsed.streams : []).filter(isObject);
  const video = streams.find((s) => s.codec_type === 'video' && !isAttachedPicture(s));
  const audio = streams.find((s) => s.codec_type === 'audio');
  const duration = isObject(parsed.format) ? toNumber(parsed.format.duration) : null;

  let width = video ? toDimension(video.width) : null;
  let height = video ? toDimension(video.height) : null;
  if (video && isQuarterTurn(rotationOf(video))) [width, height] = [height, width];

  return {
    durationSeconds: duration === null ? null : Math.round(duration),
    width,
    height,
    videoCodec: video ? toText(video.codec_name) : null,
    pixelFormat: video ? toText(video.pix_fmt) : null,
    audioCodec: audio ? toText(audio.codec_name) : null,
    hasAudio: audio !== undefined,
  };
}
