import type { MediaProbe } from '../services/parseProbeOutput';
import type { MediaDemuxer } from '../services/sniffMediaType';
import type { MediaCapabilities } from './MediaCapabilities';

/**
 * Processamento de mídia (probe, nota de voz, miniatura e forma de onda).
 *
 * Todo caminho é absoluto e gerado pela API — nunca nome ou caminho vindo do usuário. O
 * `demuxer` vem do sniff (`sniffMediaType`), não do nome nem do MIME declarado.
 * Uma única instância por processo: ela carrega o limite de concorrência.
 */
export interface IMediaProcessor {
  /** O que este processo consegue fazer — detectado no boot. */
  capabilities(): MediaCapabilities;
  /**
   * Duração, dimensões e codecs.
   * @throws {MediaProcessorUnavailableError} sem ffprobe.
   * @throws {MediaProcessingFailedError} arquivo ilegível, saída inválida ou timeout.
   */
  probe(path: string, demuxer: MediaDemuxer): Promise<MediaProbe>;
  /**
   * Converte a gravação para Ogg/Opus mono 48 kHz (nota de voz do WhatsApp) em `output`.
   * @throws {MediaProcessorUnavailableError} sem ffmpeg com libopus.
   * @throws {MediaProcessingFailedError} falha ou timeout do ffmpeg.
   */
  transcodeVoiceNote(input: string, demuxer: MediaDemuxer, output: string): Promise<void>;
  /** Miniatura JPEG de 32 px de largura em base64 de um vídeo MP4/3GP; `null` quando não sai. */
  videoThumbnailBase64(path: string): Promise<string | null>;
  /** 64 barras de 0 a 100 de uma nota de voz Ogg; `null` quando não sai. */
  voiceWaveform(oggPath: string): Promise<Uint8Array | null>;
}
