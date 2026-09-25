import { describe, it, expect } from 'vitest';
import {
  MEDIA_PROCESS_TIMEOUT_MS,
  probeArgs,
  versionArgs,
  videoThumbnailArgs,
  voiceNoteArgs,
  waveformArgs,
} from './ffmpegArgs';

const ENTRADA = '/var/data/media-uploads/abc/entrada.bin';
const SAIDA = '/var/data/media-uploads/abc/voz.ogg';

/** Base comum da §7 para o ffmpeg, com o demuxer do sniff. */
function base(demuxer: string): string[] {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-protocol_whitelist', 'file', '-format_whitelist', demuxer, '-f', demuxer];
}

describe('ffmpegArgs', () => {
  it('monta a nota de voz com a receita do legado (Opus mono 48 kHz, voip)', () => {
    expect(voiceNoteArgs(ENTRADA, 'matroska', SAIDA)).toEqual([
      ...base('matroska'),
      '-i', ENTRADA,
      '-vn', '-map_metadata', '-1', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '128k',
      '-application', 'voip', '-avoid_negative_ts', 'make_zero', '-f', 'ogg', SAIDA,
    ]);
  });

  it('monta o probe com rotação, tag rotate e capa embutida, sem -nostdin (o ffprobe não tem)', () => {
    expect(probeArgs(ENTRADA, 'mov')).toEqual([
      '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file', '-format_whitelist', 'mov', '-f', 'mov',
      '-show_entries',
      'format=duration:stream=codec_type,codec_name,pix_fmt,width,height:stream_side_data=rotation:stream_tags=rotate:stream_disposition=attached_pic',
      '-of', 'json', ENTRADA,
    ]);
  });

  it('monta a miniatura de vídeo com os parâmetros do Baileys (32 px, 1 quadro, JPEG no stdout)', () => {
    expect(videoThumbnailArgs(ENTRADA, 'mov')).toEqual([
      ...base('mov'),
      '-ss', '0', '-i', ENTRADA,
      '-vf', 'scale=32:-1', '-vframes', '1', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1',
    ]);
  });

  it('monta a forma de onda lendo o Ogg como PCM mono 8 kHz no stdout', () => {
    expect(waveformArgs(SAIDA)).toEqual([...base('ogg'), '-i', SAIDA, '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1']);
  });

  it('checa a versão sem abrir arquivo', () => {
    expect(versionArgs()).toEqual(['-version']);
  });

  it.each(['mov', 'matroska', 'ogg'] as const)('força o demuxer %s na whitelist e no -f antes da entrada', (demuxer) => {
    for (const args of [voiceNoteArgs(ENTRADA, demuxer, SAIDA), videoThumbnailArgs(ENTRADA, demuxer)]) {
      expect(args.slice(0, 10)).toEqual(base(demuxer));
      expect(args.indexOf('-i')).toBeGreaterThan(9);
    }
  });

  it('só aceita arquivo local pelo protocolo file em todos os comandos', () => {
    const todos = [voiceNoteArgs(ENTRADA, 'ogg', SAIDA), probeArgs(ENTRADA, 'ogg'), videoThumbnailArgs(ENTRADA, 'mov'), waveformArgs(SAIDA)];
    for (const args of todos) {
      const i = args.indexOf('-protocol_whitelist');
      expect(args[i + 1]).toBe('file');
      expect(args.indexOf('-format_whitelist')).toBeGreaterThan(i);
    }
  });

  it.each(['entrada.webm', './entrada.webm', '-i', 'file:entrada.webm', 'http://exemplo.com/a.webm', ''])(
    'recusa caminho que não é absoluto: %j',
    (caminho) => {
      expect(() => voiceNoteArgs(caminho, 'matroska', SAIDA)).toThrow(TypeError);
      expect(() => voiceNoteArgs(ENTRADA, 'matroska', caminho)).toThrow(TypeError);
      expect(() => probeArgs(caminho, 'mov')).toThrow(TypeError);
      expect(() => videoThumbnailArgs(caminho, 'mov')).toThrow(TypeError);
      expect(() => waveformArgs(caminho)).toThrow(TypeError);
    },
  );

  it('usa os timeouts da §7', () => {
    expect(MEDIA_PROCESS_TIMEOUT_MS).toMatchObject({ voice: 120_000, probe: 15_000, thumbnail: 20_000, waveform: 30_000 });
  });
});
