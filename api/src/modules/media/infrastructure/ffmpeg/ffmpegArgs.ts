import { isAbsolute } from 'node:path';
import type { MediaDemuxer } from '../../domain/services/sniffMediaType';

/**
 * Argumentos do ffmpeg/ffprobe (design §7). Funções puras: devolvem o array que vai direto ao
 * `spawn`, sem shell. Compatíveis com o ffmpeg 5.1 de produção.
 *
 * Toda entrada vem com `-protocol_whitelist file` (nada de rede nem de referência externa dentro
 * do contêiner) e `-format_whitelist <d> -f <d>` com o demuxer do sniff — o ffmpeg nunca adivinha
 * o formato. Caminhos precisam ser absolutos: assim nenhum argumento posicional começa com `-`
 * nem vira protocolo (`http:`, `concat:`).
 */

/** Timeout de cada operação (§7). A versão só roda no boot. */
export const MEDIA_PROCESS_TIMEOUT_MS = {
  version: 10_000,
  probe: 15_000,
  voice: 120_000,
  thumbnail: 20_000,
  waveform: 30_000,
} as const;

/** Taxa do PCM da forma de onda (`-ar` de `waveformArgs`). */
export const WAVEFORM_SAMPLE_RATE_HZ = 8000;

const PROBE_ENTRIES =
  'format=duration:stream=codec_type,codec_name,pix_fmt,width,height' +
  ':stream_side_data=rotation:stream_tags=rotate:stream_disposition=attached_pic';

function absolute(path: string): string {
  if (!isAbsolute(path)) throw new TypeError('Caminho de mídia precisa ser absoluto');
  return path;
}

function inputFormat(demuxer: MediaDemuxer): string[] {
  return ['-protocol_whitelist', 'file', '-format_whitelist', demuxer, '-f', demuxer];
}

/** Base do ffmpeg: sem banner, sem ler o terminal, só erros no stderr. */
function ffmpegBase(demuxer: MediaDemuxer): string[] {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', ...inputFormat(demuxer)];
}

/** Gravação do navegador → nota de voz Ogg/Opus mono 48 kHz (receita do legado). */
export function voiceNoteArgs(input: string, demuxer: MediaDemuxer, output: string): string[] {
  return [
    ...ffmpegBase(demuxer),
    '-i', absolute(input),
    '-vn', '-map_metadata', '-1', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '128k',
    '-application', 'voip', '-avoid_negative_ts', 'make_zero', '-f', 'ogg', absolute(output),
  ];
}

/**
 * Metadados em JSON. O ffprobe não tem `-nostdin` (recusa a opção); o stdin já vai fechado pelo
 * `spawn`. A capa embutida de áudio aparece como vídeo `mjpeg` — `attached_pic` a identifica.
 */
export function probeArgs(input: string, demuxer: MediaDemuxer): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', ...inputFormat(demuxer),
    '-show_entries', PROBE_ENTRIES, '-of', 'json', absolute(input),
  ];
}

/** Primeiro quadro em JPEG de 32 px de largura no stdout (parâmetros do Baileys). */
export function videoThumbnailArgs(input: string, demuxer: MediaDemuxer): string[] {
  return [
    ...ffmpegBase(demuxer),
    '-ss', '0', '-i', absolute(input),
    '-vf', 'scale=32:-1', '-vframes', '1', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1',
  ];
}

/** Nota de voz Ogg → PCM s16le mono 8 kHz no stdout, lido em stream. */
export function waveformArgs(oggPath: string): string[] {
  return [
    ...ffmpegBase('ogg'),
    '-i', absolute(oggPath),
    '-ac', '1', '-ar', String(WAVEFORM_SAMPLE_RATE_HZ), '-f', 's16le', 'pipe:1',
  ];
}

/** Presença do binário no boot; no ffmpeg a saída traz `--enable-libopus`. */
export function versionArgs(): string[] {
  return ['-version'];
}
