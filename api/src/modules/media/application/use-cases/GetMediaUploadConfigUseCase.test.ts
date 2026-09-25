import { describe, it, expect } from 'vitest';
import { GetMediaUploadConfigUseCase } from './GetMediaUploadConfigUseCase';
import type { MediaUploadSettings } from '../../domain/services/mediaUploadConfig';

const SETTINGS: MediaUploadSettings = {
  MEDIA_UPLOAD_CHUNK_BYTES: 8_388_608,
  MEDIA_MAX_FILES_PER_BATCH: 30,
  MEDIA_MAX_VOICE_SECONDS: 900,
  MEDIA_MAX_IMAGE_BYTES: 16_000_000,
  MEDIA_MAX_INLINE_VIDEO_BYTES: 180_000_000,
  MEDIA_MAX_DOCUMENT_BYTES: 180_000_000,
};

describe('GetMediaUploadConfigUseCase', () => {
  it('devolve limites da configuração e capacidades recebidas do processador', () => {
    const out = new GetMediaUploadConfigUseCase(SETTINGS, { transcodeVoice: true, probe: false }).execute();

    expect(out).toEqual({
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
      capabilities: { voiceNotes: true, videoMetadata: false },
    });
  });

  it('sem ffmpeg, avisa o painel que nota de voz está indisponível', () => {
    const out = new GetMediaUploadConfigUseCase(SETTINGS, { transcodeVoice: false, probe: false }).execute();
    expect(out.capabilities).toEqual({ voiceNotes: false, videoMetadata: false });
  });
});
