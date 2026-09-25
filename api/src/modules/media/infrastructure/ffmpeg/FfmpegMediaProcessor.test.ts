import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MediaProcessingFailedError,
  MediaProcessorUnavailableError,
} from '../../../../shared/errors/internal/MediaErrors';
import { FfmpegMediaProcessor } from './FfmpegMediaProcessor';
import { probeArgs, versionArgs, videoThumbnailArgs, voiceNoteArgs, waveformArgs } from './ffmpegArgs';
import { createProcessRunner, type RunProcessInput } from './runProcess';

const FFMPEG = '/usr/bin/ffmpeg';
const FFPROBE = '/usr/bin/ffprobe';
const VERSAO_FFMPEG =
  'ffmpeg version 5.1.9-0+deb12u1 Copyright (c) 2000-2025 the FFmpeg developers\n' +
  'configuration: --prefix=/usr --enable-gpl --enable-libopus --enable-libvpx\n';
const VERSAO_SEM_OPUS = 'ffmpeg version 5.1.9 Copyright (c) 2000-2025 the FFmpeg developers\nconfiguration: --prefix=/usr\n';
const VERSAO_FFPROBE = 'ffprobe version 5.1.9-0+deb12u1 Copyright (c) 2007-2025 the FFmpeg developers\n';

type Resposta = Buffer | Error | ((input: RunProcessInput) => Buffer);

/** `runProcess` falso: responde por comando + operação; sem processo real. */
function montar(respostas: Partial<Record<string, Resposta>> = {}) {
  const tabela: Record<string, Resposta> = {
    [`${FFMPEG} version`]: Buffer.from(VERSAO_FFMPEG),
    [`${FFPROBE} version`]: Buffer.from(VERSAO_FFPROBE),
    ...respostas,
  } as Record<string, Resposta>;
  const runProcess = vi.fn(async (input: RunProcessInput): Promise<Buffer> => {
    const resposta = tabela[`${input.command} ${input.operation}`];
    if (resposta === undefined) throw new Error(`sem resposta para ${input.command} ${input.operation}`);
    if (resposta instanceof Error) throw resposta;
    return typeof resposta === 'function' ? resposta(input) : resposta;
  });
  const log = { info: vi.fn(), warn: vi.fn() };
  const processor = new FfmpegMediaProcessor({ ffmpegPath: FFMPEG, ffprobePath: FFPROBE, runProcess, log });
  return { processor, runProcess, log };
}

const falhou = () => new MediaProcessingFailedError(undefined, { operation: 'probe', reason: 'exit_code', exitCode: 1 });

/** PCM s16le mono: `blocos[i]` amostras de amplitude `amplitudes[i]`, sinal alternado. */
function pcm(amplitudes: number[], amostrasPorBloco: number): Buffer {
  const buf = Buffer.alloc(amplitudes.length * amostrasPorBloco * 2);
  let offset = 0;
  for (const amplitude of amplitudes) {
    for (let j = 0; j < amostrasPorBloco; j++) {
      buf.writeInt16LE(j % 2 === 0 ? amplitude : -amplitude, offset);
      offset += 2;
    }
  }
  return buf;
}

/** Entrega o buffer em pedaços de tamanhos ímpares, partindo amostras ao meio. */
function emPedacos(buf: Buffer, consumir: (chunk: Buffer) => void): void {
  const tamanhos = [3, 7, 1, 2, 333, 5];
  for (let offset = 0, i = 0; offset < buf.length; i++) {
    const tamanho = tamanhos[i % tamanhos.length];
    consumir(buf.subarray(offset, offset + tamanho));
    offset += tamanho;
  }
}

describe('FfmpegMediaProcessor', () => {
  it('começa sem capacidades e não roda nada antes da detecção do boot', async () => {
    const { processor, runProcess } = montar();
    expect(processor.capabilities()).toEqual({ transcodeVoice: false, probe: false });
    await expect(processor.probe('/m/a.mp4', 'mov')).rejects.toBeInstanceOf(MediaProcessorUnavailableError);
    await expect(processor.transcodeVoiceNote('/m/a.webm', 'matroska', '/m/a.ogg')).rejects.toBeInstanceOf(
      MediaProcessorUnavailableError,
    );
    await expect(processor.videoThumbnailBase64('/m/a.mp4')).resolves.toBeNull();
    await expect(processor.voiceWaveform('/m/a.ogg')).resolves.toBeNull();
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('detecta ffmpeg com libopus e ffprobe no boot pela versão dos dois binários', async () => {
    const { processor, runProcess, log } = montar();
    await expect(processor.detectCapabilities()).resolves.toEqual({ transcodeVoice: true, probe: true });
    expect(processor.capabilities()).toEqual({ transcodeVoice: true, probe: true });
    expect(runProcess).toHaveBeenCalledWith(
      expect.objectContaining({ command: FFMPEG, args: versionArgs(), operation: 'version', timeoutMs: 10_000 }),
    );
    expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({ command: FFPROBE, args: versionArgs(), operation: 'version' }));
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info.mock.calls[0][0]).toMatchObject({ ffmpeg: 'ffmpeg version 5.1.9-0+deb12u1 Copyright (c) 2000-2025 the FFmpeg developers' });
  });

  it('ffmpeg sem libopus desliga só a nota de voz e avisa', async () => {
    const { processor, log } = montar({
      [`${FFMPEG} version`]: Buffer.from(VERSAO_SEM_OPUS),
      [`${FFMPEG} thumbnail`]: Buffer.from([0xff, 0xd8, 0xff]),
    });
    await expect(processor.detectCapabilities()).resolves.toEqual({ transcodeVoice: false, probe: true });
    expect(log.warn).toHaveBeenCalledOnce();
    await expect(processor.transcodeVoiceNote('/m/a.webm', 'matroska', '/m/a.ogg')).rejects.toBeInstanceOf(
      MediaProcessorUnavailableError,
    );
    await expect(processor.videoThumbnailBase64('/m/a.mp4')).resolves.toBe('/9j/');
  });

  it('binário ausente só desliga a capacidade e avisa, sem derrubar o boot', async () => {
    const { processor, log } = montar({ [`${FFMPEG} version`]: falhou(), [`${FFPROBE} version`]: falhou() });
    await expect(processor.detectCapabilities()).resolves.toEqual({ transcodeVoice: false, probe: false });
    expect(log.warn).toHaveBeenCalledTimes(2);
    await expect(processor.voiceWaveform('/m/a.ogg')).resolves.toBeNull();
  });

  it('lê duração e dimensões com o ffprobe e o demuxer do sniff', async () => {
    const saida = JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 640, height: 360, pix_fmt: 'yuv420p' }],
      format: { duration: '4.2' },
    });
    const { processor, runProcess } = montar({ [`${FFPROBE} probe`]: Buffer.from(saida) });
    await processor.detectCapabilities();

    await expect(processor.probe('/m/a.mp4', 'mov')).resolves.toMatchObject({ durationSeconds: 4, width: 640, videoCodec: 'h264' });
    expect(runProcess).toHaveBeenLastCalledWith({ command: FFPROBE, args: probeArgs('/m/a.mp4', 'mov'), timeoutMs: 15_000, operation: 'probe' });
  });

  it('saída ilegível do ffprobe vira MEDIA_PROCESSING_FAILED', async () => {
    const { processor } = montar({ [`${FFPROBE} probe`]: Buffer.from('não é json') });
    await processor.detectCapabilities();
    await expect(processor.probe('/m/a.mp4', 'mov')).rejects.toMatchObject({
      code: 'MEDIA_PROCESSING_FAILED',
      meta: { operation: 'probe', reason: 'invalid_output' },
    });
  });

  it('falha do ffprobe sobe como MEDIA_PROCESSING_FAILED', async () => {
    const { processor } = montar({ [`${FFPROBE} probe`]: falhou() });
    await processor.detectCapabilities();
    await expect(processor.probe('/m/a.mp4', 'mov')).rejects.toBeInstanceOf(MediaProcessingFailedError);
  });

  it('transcodifica a nota de voz com os argumentos e o timeout da §7', async () => {
    const { processor, runProcess } = montar({ [`${FFMPEG} voice`]: Buffer.alloc(0) });
    await processor.detectCapabilities();
    await processor.transcodeVoiceNote('/m/a.webm', 'matroska', '/m/a.ogg');
    expect(runProcess).toHaveBeenLastCalledWith({
      command: FFMPEG,
      args: voiceNoteArgs('/m/a.webm', 'matroska', '/m/a.ogg'),
      timeoutMs: 120_000,
      operation: 'voice',
    });
  });

  it('miniatura: JPEG do stdout em base64, lendo o vídeo como MP4', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01]);
    const { processor, runProcess } = montar({ [`${FFMPEG} thumbnail`]: jpeg });
    await processor.detectCapabilities();
    await expect(processor.videoThumbnailBase64('/m/a.mp4')).resolves.toBe(jpeg.toString('base64'));
    expect(runProcess).toHaveBeenLastCalledWith(
      expect.objectContaining({ args: videoThumbnailArgs('/m/a.mp4', 'mov'), timeoutMs: 20_000, operation: 'thumbnail' }),
    );
  });

  it.each([
    ['falha', falhou()],
    ['sai vazia', Buffer.alloc(0)],
  ])('miniatura que %s vira null (é opcional no envio)', async (_caso, resposta) => {
    const { processor } = montar({ [`${FFMPEG} thumbnail`]: resposta });
    await processor.detectCapabilities();
    await expect(processor.videoThumbnailBase64('/m/a.mp4')).resolves.toBeNull();
  });

  it('forma de onda: lê o PCM em stream, com amostras partidas entre pedaços, e dá o mesmo resultado do Baileys', async () => {
    // 64 blocos de 20 ms (160 amostras a 8 kHz) com amplitude crescente
    const amplitudes = Array.from({ length: 64 }, (_, i) => (i + 1) * 100);
    const { processor, runProcess } = montar({
      [`${FFMPEG} waveform`]: (input) => {
        emPedacos(pcm(amplitudes, 160), (chunk) => input.onStdout?.(chunk));
        return Buffer.alloc(0);
      },
    });
    await processor.detectCapabilities();

    const onda = await processor.voiceWaveform('/m/a.ogg');
    expect(onda).toEqual(Uint8Array.from(amplitudes, (a) => Math.floor((100 * a) / 6400)));
    expect(runProcess).toHaveBeenLastCalledWith(
      expect.objectContaining({ args: waveformArgs('/m/a.ogg'), timeoutMs: 30_000, operation: 'waveform', onStdout: expect.any(Function) }),
    );
  });

  it('forma de onda de silêncio ou de falha', async () => {
    const silencio = montar({
      [`${FFMPEG} waveform`]: (input) => {
        input.onStdout?.(Buffer.alloc(8000 * 2));
        return Buffer.alloc(0);
      },
    });
    await silencio.processor.detectCapabilities();
    await expect(silencio.processor.voiceWaveform('/m/a.ogg')).resolves.toEqual(new Uint8Array(64));

    const falha = montar({ [`${FFMPEG} waveform`]: falhou() });
    await falha.processor.detectCapabilities();
    await expect(falha.processor.voiceWaveform('/m/a.ogg')).resolves.toBeNull();
  });
});

// ── Integração opcional: roda só com ffmpeg (com libopus) e ffprobe no PATH ─────────────────

function temFfmpeg(): boolean {
  const encoders = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  const ffprobe = spawnSync('ffprobe', ['-version']);
  return encoders.status === 0 && encoders.stdout.includes('libopus') && ffprobe.status === 0;
}

function gerar(args: string[]): void {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg de teste falhou: ${r.stderr?.toString()}`);
}

describe.skipIf(!temFfmpeg())('FfmpegMediaProcessor com ffmpeg real', () => {
  let pasta: string;
  let webm: string;
  let mp4: string;
  const mudo = { info: () => undefined, warn: () => undefined };
  const processor = new FfmpegMediaProcessor({
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    runProcess: createProcessRunner({ concurrency: 2, log: mudo }),
    log: mudo,
  });

  beforeAll(async () => {
    pasta = mkdtempSync(join(tmpdir(), 'media-processor-'));
    webm = join(pasta, 'gravacao.webm');
    mp4 = join(pasta, 'video.mp4');
    gerar(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libopus', '-f', 'webm', webm]);
    gerar(['-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10', '-c:v', 'mpeg4', '-f', 'mp4', mp4]);
    await processor.detectCapabilities();
  });

  afterAll(() => {
    rmSync(pasta, { recursive: true, force: true });
  });

  it('detecta as duas capacidades', () => {
    expect(processor.capabilities()).toEqual({ transcodeVoice: true, probe: true });
  });

  it('transcodifica a gravação WebM em nota de voz Ogg/Opus com duração e onda de 64 barras', async () => {
    const ogg = join(pasta, 'voz.ogg');
    await processor.transcodeVoiceNote(webm, 'matroska', ogg);

    await expect(processor.probe(ogg, 'ogg')).resolves.toMatchObject({ durationSeconds: 2, audioCodec: 'opus', hasAudio: true, videoCodec: null });
    const onda = await processor.voiceWaveform(ogg);
    expect(onda).toHaveLength(64);
    expect(Math.max(...(onda ?? []))).toBe(100);
  });

  it('recusa arquivo cujo conteúdo não é do demuxer informado', async () => {
    await expect(processor.probe(webm, 'mov')).rejects.toBeInstanceOf(MediaProcessingFailedError);
  });

  it('gera a miniatura JPEG do vídeo', async () => {
    const base64 = await processor.videoThumbnailBase64(mp4);
    expect(base64).not.toBeNull();
    expect(Buffer.from(base64 ?? '', 'base64').subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });
});
