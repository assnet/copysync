import { env } from '../../../../shared/config/env';
import {
  MediaProcessingFailedError,
  MediaProcessorUnavailableError,
} from '../../../../shared/errors/internal/MediaErrors';
import { logger } from '../../../../shared/logger/logger';
import type { IMediaProcessor } from '../../domain/contracts/IMediaProcessor';
import type { MediaCapabilities } from '../../domain/contracts/MediaCapabilities';
import { buildWaveform } from '../../domain/services/buildWaveform';
import { InvalidProbeOutputError, parseProbeOutput, type MediaProbe } from '../../domain/services/parseProbeOutput';
import type { MediaDemuxer } from '../../domain/services/sniffMediaType';
import {
  MEDIA_PROCESS_TIMEOUT_MS,
  WAVEFORM_SAMPLE_RATE_HZ,
  probeArgs,
  versionArgs,
  videoThumbnailArgs,
  voiceNoteArgs,
  waveformArgs,
} from './ffmpegArgs';
import { createProcessRunner, type RunProcess } from './runProcess';

/** Só MP4/3GP vai como vídeo (`classifyOutboundMedia`); o resto vira documento, sem miniatura. */
const INLINE_VIDEO_DEMUXER: MediaDemuxer = 'mov';

/**
 * Amostras por nível da onda: 20 ms. Nota de voz a partir de 1,28 s já dá 64 níveis ou mais, e
 * 15 min (`MEDIA_MAX_VOICE_SECONDS`) somam 45 mil números — o PCM inteiro seria 14 MB.
 */
const LEVEL_BLOCK_SAMPLES = WAVEFORM_SAMPLE_RATE_HZ / 50;

export interface ProcessorLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface FfmpegMediaProcessorOptions {
  /** Padrão `FFMPEG_PATH`. */
  ffmpegPath?: string;
  /** Padrão `FFPROBE_PATH`. */
  ffprobePath?: string;
  /** Padrão: executor com `MEDIA_PROCESS_CONCURRENCY` processos simultâneos. */
  runProcess?: RunProcess;
  log?: ProcessorLog;
}

/**
 * Média do valor absoluto do PCM s16le por bloco, consumida pedaço a pedaço do stdout.
 * Uma amostra pode chegar partida entre dois pedaços. Como no Baileys, o resto do fim que não
 * fecha um bloco é descartado.
 */
class PcmLevelMeter {
  readonly levels: number[] = [];
  private sum = 0;
  private count = 0;
  private carry: number | null = null;

  push(chunk: Buffer): void {
    let offset = 0;
    if (this.carry !== null && chunk.length > 0) {
      this.add(((chunk[0] << 24) | (this.carry << 16)) >> 16);
      this.carry = null;
      offset = 1;
    }
    const end = chunk.length - ((chunk.length - offset) % 2);
    for (let i = offset; i < end; i += 2) this.add(chunk.readInt16LE(i));
    if (end < chunk.length) this.carry = chunk[end];
  }

  private add(sample: number): void {
    this.sum += Math.abs(sample);
    if (++this.count < LEVEL_BLOCK_SAMPLES) return;
    this.levels.push(this.sum / LEVEL_BLOCK_SAMPLES);
    this.sum = 0;
    this.count = 0;
  }
}

function firstLine(text: string | null): string | null {
  return text === null ? null : (text.split('\n', 1)[0] ?? '').trim();
}

/**
 * `IMediaProcessor` com ffmpeg/ffprobe (design §7). ffmpeg só existe aqui, na infra do `media`.
 *
 * `detectCapabilities()` roda no boot; antes dele tudo fica desligado. Binário ausente nunca
 * derruba a API: a capacidade desliga e o motivo vai para o log (`warn`).
 * Uma instância por processo — o semáforo de concorrência vive no `runProcess`.
 */
export class FfmpegMediaProcessor implements IMediaProcessor {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly run: RunProcess;
  private readonly log: ProcessorLog;
  /** ffmpeg presente, com ou sem libopus: miniatura e forma de onda dependem só dele. */
  private ffmpegAvailable = false;
  private caps: MediaCapabilities = { transcodeVoice: false, probe: false };

  constructor(options: FfmpegMediaProcessorOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? env.FFMPEG_PATH;
    this.ffprobePath = options.ffprobePath ?? env.FFPROBE_PATH;
    this.run = options.runProcess ?? createProcessRunner({ concurrency: env.MEDIA_PROCESS_CONCURRENCY });
    this.log = options.log ?? logger.child({ module: 'FfmpegMediaProcessor' });
  }

  async detectCapabilities(): Promise<MediaCapabilities> {
    const [ffmpeg, ffprobe] = await Promise.all([this.version(this.ffmpegPath), this.version(this.ffprobePath)]);
    this.ffmpegAvailable = ffmpeg !== null;
    this.caps = { transcodeVoice: ffmpeg?.includes('--enable-libopus') ?? false, probe: ffprobe !== null };

    if (ffmpeg === null) {
      this.log.warn({ capability: 'transcodeVoice' }, 'ffmpeg indisponível: nota de voz, miniatura e forma de onda desligadas');
    } else if (!this.caps.transcodeVoice) {
      this.log.warn({ capability: 'transcodeVoice' }, 'ffmpeg sem libopus: nota de voz desligada');
    }
    if (ffprobe === null) {
      this.log.warn({ capability: 'probe' }, 'ffprobe indisponível: vídeo sai como documento');
    }
    this.log.info({ ffmpeg: firstLine(ffmpeg), ffprobe: firstLine(ffprobe), ...this.caps }, 'Capacidades de mídia detectadas');
    return this.capabilities();
  }

  capabilities(): MediaCapabilities {
    return { ...this.caps };
  }

  async probe(path: string, demuxer: MediaDemuxer): Promise<MediaProbe> {
    if (!this.caps.probe) throw new MediaProcessorUnavailableError();
    const stdout = await this.run({
      command: this.ffprobePath,
      args: probeArgs(path, demuxer),
      timeoutMs: MEDIA_PROCESS_TIMEOUT_MS.probe,
      operation: 'probe',
    });
    try {
      return parseProbeOutput(stdout.toString('utf8'));
    } catch (err) {
      if (err instanceof InvalidProbeOutputError) {
        throw new MediaProcessingFailedError(undefined, { operation: 'probe', reason: 'invalid_output' });
      }
      throw err;
    }
  }

  /** Em falha, `output` pode ficar parcial — quem chama limpa a pasta temporária. */
  async transcodeVoiceNote(input: string, demuxer: MediaDemuxer, output: string): Promise<void> {
    if (!this.caps.transcodeVoice) throw new MediaProcessorUnavailableError();
    await this.run({
      command: this.ffmpegPath,
      args: voiceNoteArgs(input, demuxer, output),
      timeoutMs: MEDIA_PROCESS_TIMEOUT_MS.voice,
      operation: 'voice',
    });
  }

  async videoThumbnailBase64(path: string): Promise<string | null> {
    if (!this.ffmpegAvailable) return null;
    const jpeg = await this.optional(
      this.run({
        command: this.ffmpegPath,
        args: videoThumbnailArgs(path, INLINE_VIDEO_DEMUXER),
        timeoutMs: MEDIA_PROCESS_TIMEOUT_MS.thumbnail,
        operation: 'thumbnail',
      }),
    );
    return jpeg !== null && jpeg.length > 0 ? jpeg.toString('base64') : null;
  }

  async voiceWaveform(oggPath: string): Promise<Uint8Array | null> {
    if (!this.ffmpegAvailable) return null;
    const meter = new PcmLevelMeter();
    const done = await this.optional(
      this.run({
        command: this.ffmpegPath,
        args: waveformArgs(oggPath),
        timeoutMs: MEDIA_PROCESS_TIMEOUT_MS.waveform,
        operation: 'waveform',
        onStdout: (chunk) => meter.push(chunk),
      }),
    );
    return done === null ? null : buildWaveform(meter.levels);
  }

  /** Saída da versão; `null` quando o binário não roda (a falha já foi logada pelo executor). */
  private async version(command: string): Promise<string | null> {
    const stdout = await this.optional(
      this.run({ command, args: versionArgs(), timeoutMs: MEDIA_PROCESS_TIMEOUT_MS.version, operation: 'version' }),
    );
    return stdout === null ? null : stdout.toString('utf8');
  }

  /** Miniatura e onda são opcionais no envio: falha de processamento vira `null`. */
  private async optional<T>(pending: Promise<T>): Promise<T | null> {
    try {
      return await pending;
    } catch (err) {
      if (err instanceof MediaProcessingFailedError) return null;
      throw err;
    }
  }
}
