import { describe, it, expect } from 'vitest';
import { classifyOutboundMedia, type ClassifyOutboundMediaInput } from './classifyOutboundMedia';
import type { MediaProbe } from './parseProbeOutput';
import type { SniffedMediaType } from './sniffMediaType';

// Limites pequenos e distintos: deixam cada fronteira (= passa, +1 muda) visível.
const LIMITS = { imageBytes: 100, inlineVideoBytes: 500, documentBytes: 1_000, voiceBytes: 300 };

const JPEG: SniffedMediaType = { mimeType: 'image/jpeg', demuxer: null };
const PNG: SniffedMediaType = { mimeType: 'image/png', demuxer: null };
const WEBP: SniffedMediaType = { mimeType: 'image/webp', demuxer: null };
const GIF: SniffedMediaType = { mimeType: 'image/gif', demuxer: null };
const HEIC: SniffedMediaType = { mimeType: 'image/heic', demuxer: null };
const SVG: SniffedMediaType = { mimeType: 'image/svg+xml', demuxer: null };
const MP4: SniffedMediaType = { mimeType: 'video/mp4', demuxer: 'mov' };
const THREE_GP: SniffedMediaType = { mimeType: 'video/3gpp', demuxer: 'mov' };
const MOV: SniffedMediaType = { mimeType: 'video/quicktime', demuxer: 'mov' };
const WEBM: SniffedMediaType = { mimeType: 'video/webm', demuxer: 'matroska' };
const OGG: SniffedMediaType = { mimeType: 'audio/ogg', demuxer: 'ogg' };
const M4A: SniffedMediaType = { mimeType: 'audio/mp4', demuxer: 'mov' };
const PDF: SniffedMediaType = { mimeType: 'application/pdf', demuxer: null };
const UNKNOWN: SniffedMediaType = { mimeType: 'application/octet-stream', demuxer: null };
/** `ftyp` de brand desconhecida: `video/mp4` é só palpite para o ffprobe confirmar. */
const FTYP_GENERICO = (declaredMimeType: string | null): SniffedMediaType => ({
  mimeType: 'video/mp4', demuxer: 'mov', generic: true, declaredMimeType,
});

const H264_VIDEO: MediaProbe = {
  durationSeconds: 12,
  width: 1280,
  height: 720,
  videoCodec: 'h264',
  pixelFormat: 'yuv420p',
  audioCodec: 'aac',
  hasAudio: true,
};

const VOICE_AUDIO: MediaProbe = {
  durationSeconds: 7,
  width: null,
  height: null,
  videoCodec: null,
  pixelFormat: null,
  audioCodec: 'opus',
  hasAudio: true,
};

function classify(overrides: Partial<ClassifyOutboundMediaInput>) {
  return classifyOutboundMedia({
    purpose: 'media',
    sniffed: JPEG,
    sizeBytes: 10,
    probe: null,
    limits: LIMITS,
    ...overrides,
  });
}

const CONVERTED = (mimeType: string) => ({ kind: 'document', mimeType, reason: 'converted_to_document' });

function expectTooLarge(run: () => unknown, limitBytes: number, kind: string) {
  expect(run).toThrowError(
    expect.objectContaining({ code: 'MEDIA_TOO_LARGE', statusCode: 413, meta: { limitBytes, kind } }),
  );
}

function expectUnsupported(run: () => unknown) {
  expect(run).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_MEDIA_TYPE', statusCode: 415 }));
}

describe('classifyOutboundMedia — voz', () => {
  it.each([OGG, WEBM, M4A, MP4])('aceita gravação $mimeType com áudio e entrega como voz em Opus', (sniffed) => {
    expect(classify({ purpose: 'voice', sniffed, probe: VOICE_AUDIO })).toEqual({
      kind: 'voice',
      mimeType: 'audio/ogg; codecs=opus',
    });
  });

  it('recusa gravação sem trilha de áudio', () => {
    expectUnsupported(() => classify({ purpose: 'voice', sniffed: OGG, probe: { ...VOICE_AUDIO, hasAudio: false } }));
  });

  it('recusa voz sem probe, porque a conversão para Opus depende do ffmpeg', () => {
    expectUnsupported(() => classify({ purpose: 'voice', sniffed: OGG, probe: null }));
  });

  it.each([JPEG, PDF, THREE_GP, UNKNOWN])('recusa $mimeType como voz mesmo com probe de áudio', (sniffed) => {
    expectUnsupported(() => classify({ purpose: 'voice', sniffed, probe: VOICE_AUDIO }));
  });

  it('aceita gravação com exatamente o limite de voz', () => {
    const result = classify({ purpose: 'voice', sniffed: OGG, probe: VOICE_AUDIO, sizeBytes: LIMITS.voiceBytes });
    expect(result.kind).toBe('voice');
  });

  it('recusa gravação 1 byte acima do limite de voz', () => {
    expectTooLarge(
      () => classify({ purpose: 'voice', sniffed: OGG, probe: VOICE_AUDIO, sizeBytes: LIMITS.voiceBytes + 1 }),
      LIMITS.voiceBytes,
      'voice',
    );
  });
});

describe('classifyOutboundMedia — imagem', () => {
  it.each([JPEG, PNG, WEBP])('envia $mimeType como imagem com o tipo identificado', (sniffed) => {
    expect(classify({ sniffed })).toEqual({ kind: 'image', mimeType: sniffed.mimeType });
  });

  it('envia como imagem com exatamente o limite de imagem', () => {
    expect(classify({ sniffed: PNG, sizeBytes: LIMITS.imageBytes })).toEqual({ kind: 'image', mimeType: 'image/png' });
  });

  it('converte para documento a imagem 1 byte acima do limite de imagem', () => {
    expect(classify({ sniffed: PNG, sizeBytes: LIMITS.imageBytes + 1 })).toEqual(CONVERTED('image/png'));
  });

  it.each([HEIC, GIF, SVG])('converte $mimeType para documento', (sniffed) => {
    expect(classify({ sniffed })).toEqual(CONVERTED(sniffed.mimeType));
  });
});

describe('classifyOutboundMedia — vídeo', () => {
  it('envia MP4 H.264 yuv420p como vídeo', () => {
    expect(classify({ sniffed: MP4, probe: H264_VIDEO })).toEqual({ kind: 'video', mimeType: 'video/mp4' });
  });

  it('envia 3GP H.264 yuv420p como vídeo mantendo video/3gpp', () => {
    expect(classify({ sniffed: THREE_GP, probe: H264_VIDEO })).toEqual({ kind: 'video', mimeType: 'video/3gpp' });
  });

  it('envia como vídeo com exatamente o limite de vídeo inline', () => {
    const result = classify({ sniffed: MP4, probe: H264_VIDEO, sizeBytes: LIMITS.inlineVideoBytes });
    expect(result).toEqual({ kind: 'video', mimeType: 'video/mp4' });
  });

  it('converte para documento o vídeo 1 byte acima do limite inline', () => {
    const result = classify({ sniffed: MP4, probe: H264_VIDEO, sizeBytes: LIMITS.inlineVideoBytes + 1 });
    expect(result).toEqual(CONVERTED('video/mp4'));
  });

  it('converte para documento o vídeo sem probe, porque o codec é desconhecido', () => {
    expect(classify({ sniffed: MP4, probe: null })).toEqual(CONVERTED('video/mp4'));
  });

  it('converte para documento o vídeo HEVC', () => {
    expect(classify({ sniffed: MP4, probe: { ...H264_VIDEO, videoCodec: 'hevc' } })).toEqual(CONVERTED('video/mp4'));
  });

  it('converte para documento o vídeo H.264 de 10 bits (yuv420p10le)', () => {
    const probe = { ...H264_VIDEO, pixelFormat: 'yuv420p10le' };
    expect(classify({ sniffed: MP4, probe })).toEqual(CONVERTED('video/mp4'));
  });

  it('converte para documento o MP4 sem trilha de vídeo', () => {
    expect(classify({ sniffed: MP4, probe: VOICE_AUDIO })).toEqual(CONVERTED('video/mp4'));
  });

  it.each([MOV, WEBM])('converte $mimeType para documento mesmo em H.264 yuv420p', (sniffed) => {
    expect(classify({ sniffed, probe: H264_VIDEO })).toEqual(CONVERTED(sniffed.mimeType));
  });

  it('recusa com 413 o vídeo convertido que passa do limite de documento', () => {
    expectTooLarge(
      () => classify({ sniffed: MP4, probe: H264_VIDEO, sizeBytes: LIMITS.documentBytes + 1 }),
      LIMITS.documentBytes,
      'document',
    );
  });

  it('com os limites padrão (180 MB), vídeo 1 byte acima do inline não cabe como documento', () => {
    const limits = { ...LIMITS, inlineVideoBytes: 180_000_000, documentBytes: 180_000_000 };
    expect(classify({ sniffed: MP4, probe: H264_VIDEO, sizeBytes: 180_000_000, limits }).kind).toBe('video');
    expectTooLarge(
      () => classify({ sniffed: MP4, probe: H264_VIDEO, sizeBytes: 180_000_001, limits }),
      180_000_000,
      'document',
    );
  });
});

describe('classifyOutboundMedia — outros arquivos em "fotos e vídeos"', () => {
  it.each([PDF, OGG, UNKNOWN])('converte $mimeType para documento', (sniffed) => {
    expect(classify({ sniffed })).toEqual(CONVERTED(sniffed.mimeType));
  });

  it('recusa com 413 a imagem convertida que passa do limite de documento', () => {
    expectTooLarge(() => classify({ sniffed: JPEG, sizeBytes: LIMITS.documentBytes + 1 }), LIMITS.documentBytes, 'document');
  });
});

describe('classifyOutboundMedia — documento', () => {
  it.each([JPEG, MP4, PDF, UNKNOWN])('envia $mimeType como documento com o tipo identificado, sem aviso', (sniffed) => {
    expect(classify({ purpose: 'document', sniffed, probe: H264_VIDEO })).toEqual({
      kind: 'document',
      mimeType: sniffed.mimeType,
    });
  });

  it('envia como documento com exatamente o limite de documento', () => {
    const result = classify({ purpose: 'document', sniffed: PDF, sizeBytes: LIMITS.documentBytes });
    expect(result).toEqual({ kind: 'document', mimeType: 'application/pdf' });
  });

  it('recusa documento 1 byte acima do limite de documento', () => {
    expectTooLarge(
      () => classify({ purpose: 'document', sniffed: PDF, sizeBytes: LIMITS.documentBytes + 1 }),
      LIMITS.documentBytes,
      'document',
    );
  });
});

describe('classifyOutboundMedia — ftyp de brand desconhecida', () => {
  it('documento usa o declarado saneado, não o palpite de vídeo — mesmo com probe', () => {
    expect(classify({ purpose: 'document', sniffed: FTYP_GENERICO('application/x-canon-cr3'), probe: H264_VIDEO }))
      .toEqual({ kind: 'document', mimeType: 'application/x-canon-cr3' });
  });

  it('documento sem declarado sai como application/octet-stream', () => {
    expect(classify({ purpose: 'document', sniffed: FTYP_GENERICO(null) }))
      .toEqual({ kind: 'document', mimeType: 'application/octet-stream' });
  });

  it('em "fotos e vídeos", sem probe vira documento com o declarado', () => {
    expect(classify({ sniffed: FTYP_GENERICO('application/x-canon-cr3'), probe: null }))
      .toEqual(CONVERTED('application/x-canon-cr3'));
    expect(classify({ sniffed: FTYP_GENERICO(null), probe: null })).toEqual(CONVERTED('application/octet-stream'));
  });

  it('em "fotos e vídeos", o probe que confirma H.264 yuv420p ainda manda como vídeo', () => {
    expect(classify({ sniffed: FTYP_GENERICO(null), probe: H264_VIDEO })).toEqual({ kind: 'video', mimeType: 'video/mp4' });
  });

  it('em "fotos e vídeos", probe que não confirma vídeo inline vira documento com o declarado', () => {
    const probe = { ...H264_VIDEO, videoCodec: 'hevc' };
    expect(classify({ sniffed: FTYP_GENERICO('video/x-outro'), probe })).toEqual(CONVERTED('video/x-outro'));
  });

  it('o documento genérico continua sujeito ao limite de documento', () => {
    expectTooLarge(
      () => classify({ purpose: 'document', sniffed: FTYP_GENERICO(null), sizeBytes: LIMITS.documentBytes + 1 }),
      LIMITS.documentBytes,
      'document',
    );
  });
});

describe('classifyOutboundMedia — arquivo vazio', () => {
  it.each(['media', 'document', 'voice'] as const)('recusa arquivo de 0 byte na finalidade %s', (purpose) => {
    expect(() => classify({ purpose, sniffed: OGG, probe: VOICE_AUDIO, sizeBytes: 0 })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });
});
