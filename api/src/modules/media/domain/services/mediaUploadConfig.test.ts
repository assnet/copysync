import { describe, it, expect } from 'vitest';
import { buildMediaUploadConfig, type MediaUploadSettings } from './mediaUploadConfig';

/** Os padrões da tabela de configuração. */
function padroes(overrides: Partial<MediaUploadSettings> = {}): MediaUploadSettings {
  return {
    MEDIA_UPLOAD_CHUNK_BYTES: 8_388_608,
    MEDIA_MAX_FILES_PER_BATCH: 30,
    MEDIA_MAX_VOICE_SECONDS: 900,
    MEDIA_MAX_IMAGE_BYTES: 16_000_000,
    MEDIA_MAX_INLINE_VIDEO_BYTES: 180_000_000,
    MEDIA_MAX_DOCUMENT_BYTES: 180_000_000,
    ...overrides,
  };
}

describe('buildMediaUploadConfig', () => {
  it('expõe ao painel os limites padrão e as capacidades disponíveis', () => {
    expect(buildMediaUploadConfig(padroes(), { transcodeVoice: true, probe: true })).toEqual({
      chunkSizeBytes: 8_388_608,
      maxFilesPerBatch: 30,
      maxVoiceSeconds: 900,
      maxCaptionLength: 4096,
      limits: {
        imageBytes: 16_000_000,
        inlineVideoBytes: 180_000_000,
        documentBytes: 180_000_000,
        voiceBytes: 58_982_400,
      },
      capabilities: { voiceNotes: true, videoMetadata: true },
    });
  });

  it('calcula o limite da voz a 64 KiB por segundo de gravação', () => {
    const config = buildMediaUploadConfig(padroes({ MEDIA_MAX_VOICE_SECONDS: 60 }), {
      transcodeVoice: true,
      probe: true,
    });

    expect(config.limits.voiceBytes).toBe(60 * 64 * 1024);
  });

  it('desliga a nota de voz quando não há como transcodificar', () => {
    const config = buildMediaUploadConfig(padroes(), { transcodeVoice: false, probe: true });

    expect(config.capabilities).toEqual({ voiceNotes: false, videoMetadata: true });
  });

  it('avisa que não há metadados de vídeo quando não há probe', () => {
    const config = buildMediaUploadConfig(padroes(), { transcodeVoice: true, probe: false });

    expect(config.capabilities).toEqual({ voiceNotes: true, videoMetadata: false });
  });

  it('reflete limites configurados fora do padrão', () => {
    const config = buildMediaUploadConfig(
      padroes({
        MEDIA_UPLOAD_CHUNK_BYTES: 1_048_576,
        MEDIA_MAX_FILES_PER_BATCH: 5,
        MEDIA_MAX_IMAGE_BYTES: 5_000_000,
        MEDIA_MAX_INLINE_VIDEO_BYTES: 64_000_000,
        MEDIA_MAX_DOCUMENT_BYTES: 100_000_000,
      }),
      { transcodeVoice: false, probe: false },
    );

    expect(config).toMatchObject({
      chunkSizeBytes: 1_048_576,
      maxFilesPerBatch: 5,
      limits: { imageBytes: 5_000_000, inlineVideoBytes: 64_000_000, documentBytes: 100_000_000 },
    });
  });
});
